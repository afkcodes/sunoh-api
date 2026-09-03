import { fromSong, type SongLike } from './normalize';
import * as hifi from './providers/hifi';
import * as musicbrainz from './providers/musicbrainz';
import { bestMatch, rankCandidates } from './score';
import { normalizeIsrc } from './text';
import type { CanonicalTrack, CatalogSource, LosslessMatch, MatchOptions } from './types';

/**
 * Find the lossless recording for a Saavn or Gaana track.
 *
 * Two tiers, deliberately:
 *
 *   1. Resolve an ISRC. Neither Saavn nor Gaana publishes one, so it is
 *      bridged from MusicBrainz. A bridge candidate must itself score highly
 *      before its ISRC is adopted, because inheriting a wrong ISRC turns a soft
 *      fuzzy miss into a confident wrong answer.
 *   2. Search the lossless catalogue. ISRC first when known, otherwise scored
 *      text search. Anything below the threshold is reported as unavailable
 *      rather than returned, since handing back a remix is worse than nothing.
 */

/** A bridge result must clear this before its ISRC is trusted. */
const BRIDGE_THRESHOLD = 82;

/**
 * How many qualifying MusicBrainz recordings to probe for an ISRC. Popular
 * tracks have dozens of registered recordings and only some carry one, so
 * probing only the top match loses ISRCs that are genuinely there.
 */
const MAX_ISRC_LOOKUPS = 4;

export interface IsrcResolution {
  isrc?: string;
  source?: CatalogSource;
  confidence?: number;
  corroboration: CanonicalTrack[];
}

/** Attach an ISRC to `track` by finding the same recording on MusicBrainz. */
export async function resolveIsrc(
  track: CanonicalTrack,
  signal?: AbortSignal,
): Promise<IsrcResolution> {
  const existing = normalizeIsrc(track.isrc);
  if (existing) {
    return { isrc: existing, source: track.source, confidence: 100, corroboration: [] };
  }
  if (!track.title) return { corroboration: [] };

  try {
    const candidates = await musicbrainz.searchRecordings({
      title: track.title,
      // Every credited name, never just the first: film catalogues list the
      // composer ahead of the singers MusicBrainz actually credits.
      artists: track.artists,
      album: track.album,
      limit: 10,
      signal,
      stopWhen: (found) => bestMatch(track, found, { threshold: BRIDGE_THRESHOLD }) !== null,
    });

    const ranked = rankCandidates(track, candidates, { threshold: BRIDGE_THRESHOLD });

    for (const match of ranked) {
      const direct = normalizeIsrc(match.candidate.isrc);
      if (direct) {
        return { isrc: direct, source: 'musicbrainz', confidence: match.score, corroboration: candidates };
      }
    }

    for (const match of ranked.slice(0, MAX_ISRC_LOOKUPS)) {
      if (!match.candidate.sourceId) continue;
      const isrcs = await musicbrainz.getRecordingIsrcs(match.candidate.sourceId, signal);
      const first = isrcs.map(normalizeIsrc).find(Boolean);
      if (first) {
        return { isrc: first, source: 'musicbrainz', confidence: match.score, corroboration: candidates };
      }
    }

    return { corroboration: candidates };
  } catch {
    // A dead bridge must never fail the whole lookup.
    return { corroboration: [] };
  }
}

/** Fill in fields the source left blank, using the best corroborating track. */
function enrich(track: CanonicalTrack, corroboration: readonly CanonicalTrack[]): CanonicalTrack {
  if (corroboration.length === 0) return track;
  const match = bestMatch(track, corroboration, { threshold: BRIDGE_THRESHOLD });
  if (!match) return track;
  const c = match.candidate;
  return {
    ...track,
    durationSec: track.durationSec ?? c.durationSec,
    album: track.album ?? c.album,
    year: track.year ?? c.year,
    artists: track.artists.length ? track.artists : c.artists,
  };
}

/**
 * Query shapes to try, most specific first. The second artist gets its own
 * attempt because film catalogues often list the composer first while the
 * lossless catalogue indexes the performer.
 */
function buildQueries(target: CanonicalTrack): string[] {
  const title = target.rawTitle ?? target.title;
  const queries = [
    [title, target.artists[0]].filter(Boolean).join(' '),
    [title, target.artists[1]].filter(Boolean).join(' '),
    [title, target.album].filter(Boolean).join(' '),
    title,
  ];
  return Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
}

/** Match an already-normalized track against the lossless catalogue. */
export async function matchCanonical(
  target: CanonicalTrack,
  options: MatchOptions = {},
): Promise<LosslessMatch> {
  const started = Date.now();
  const reasons: string[] = [];
  let enriched = target;

  let isrc = normalizeIsrc(target.isrc);
  let isrcSource: CatalogSource | undefined = isrc ? target.source : undefined;

  if (!isrc && (options.enrichIsrc ?? true)) {
    const resolution = await resolveIsrc(target, options.signal);
    isrc = resolution.isrc;
    isrcSource = resolution.source;
    enriched = enrich(target, resolution.corroboration);
    if (isrc) {
      // Flagged as inferred so a later mismatch is not held against a candidate.
      enriched = { ...enriched, isrc, isrcInferred: true };
      reasons.push(`ISRC ${isrc} resolved via ${resolution.source} (${resolution.confidence?.toFixed(0)})`);
    } else {
      reasons.push('no ISRC found; matching on title, artist and duration');
    }
  }

  const candidates: CanonicalTrack[] = [];

  // Exact path first.
  if (isrc) {
    const byIsrc = await hifi.searchByIsrc(isrc, { signal: options.signal });
    const exact = byIsrc.find((c) => normalizeIsrc(c.isrc) === isrc);
    if (exact) {
      reasons.push('exact ISRC match in the lossless catalogue');
      return {
        target: enriched,
        isrc,
        isrcSource,
        lossless: { ...exact, score: 100, exact: true },
        reasons,
        elapsedMs: Date.now() - started,
      };
    }
    candidates.push(...byIsrc);
  }

  // Scored text search.
  for (const query of buildQueries(enriched)) {
    if (options.signal?.aborted) break;
    const results = await hifi.search(query, { limit: 20, signal: options.signal });
    candidates.push(...results);
    if (bestMatch(enriched, candidates, options)) break;
  }

  if (candidates.length === 0) {
    reasons.push('lossless catalogue returned no candidates');
    return { target: enriched, isrc, isrcSource, lossless: null, reasons, elapsedMs: Date.now() - started };
  }

  const top = rankCandidates(enriched, candidates, options)[0];
  if (!top) {
    reasons.push(`no candidate cleared the match threshold (${candidates.length} seen)`);
    return { target: enriched, isrc, isrcSource, lossless: null, reasons, elapsedMs: Date.now() - started };
  }

  reasons.push(...top.reasons);
  return {
    target: enriched,
    isrc,
    isrcSource,
    lossless: { ...top.candidate, score: top.score, exact: top.exact },
    reasons,
    elapsedMs: Date.now() - started,
  };
}

/** Match one Song from Saavn or Gaana. */
export async function matchSong(song: SongLike, options: MatchOptions = {}): Promise<LosslessMatch> {
  return matchCanonical(fromSong(song), options);
}

/**
 * Match many songs with bounded concurrency.
 *
 * The cap is low on purpose: the ISRC bridge is rate-limited to roughly one
 * request per second, so a wide fan-out would queue behind it anyway while
 * hammering the lossless instances.
 */
export async function matchSongs(
  songs: readonly SongLike[],
  options: MatchOptions & { concurrency?: number } = {},
): Promise<LosslessMatch[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const out: LosslessMatch[] = new Array(songs.length);
  let index = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = index++;
      if (i >= songs.length) return;
      try {
        out[i] = await matchSong(songs[i]!, options);
      } catch (err) {
        out[i] = {
          target: fromSong(songs[i]!),
          lossless: null,
          reasons: [`match failed: ${err instanceof Error ? err.message : String(err)}`],
          elapsedMs: 0,
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, worker));
  return out;
}
