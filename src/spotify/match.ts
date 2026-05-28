// Match a Spotify track to a Saavn song.
//
// Strategy (in order — first hit wins):
//
//   1. Persistent Redis cache keyed by Spotify track id. Mappings are
//      effectively immutable (a given Spotify ID will always point at
//      the same recording, and that recording either is or isn't on
//      Saavn) so the cache never expires.
//
//   2. ISRC-as-query. JioSaavn doesn't index ISRC directly but a
//      surprising number of catalog records carry it in the title or
//      free-text fields. Cheap to try — single search call, exact hit
//      or skip.
//
//   3. Cleaned-title + artist fuzzy search. The same scorer as the old
//      `maptoSaavn.ts` (token Jaccard + character overlap + duration
//      penalty), but called against the in-process Saavn helper rather
//      than HTTP-looping back through our own /saavn/search endpoint.
//      Net: zero localhost round-trips per track.
//
// Output per track is the same shape the old queue produced — a
// `{ spotify, saavn, score, matched }` quad — so the controller can
// summarise hits/misses for the client.

import { cache } from '../redis';
import { getSaavnSearchData } from '../saavn/controller';
import type { SpotifyTrack } from './types';

const MATCH_CACHE_KEY = (spotifyId: string) => `spotify_to_saavn_v1_${spotifyId}`;
/** No TTL — mappings don't go stale (a recording's identity is
 *  permanent; if a track gets removed from Saavn we can rediscover via
 *  cache.delete on a manual flush). */
const MATCH_CACHE_TTL = 60 * 60 * 24 * 365;
/** Below this we don't trust the fuzzy match — surfaced as `matched:false`
 *  with the candidate still attached so the UI can show "we tried this,
 *  not confident" instead of nothing. */
const MIN_ACCEPT_SCORE = 0.55;

export interface SaavnCandidate {
  id?: string;
  title?: string;
  name?: string;
  subtitle?: string;
  album?: string;
  albumId?: string;
  primaryArtists?: string;
  music?: string;
  singers?: string;
  duration?: string;
  images?: Array<{ quality: string; link: string }>;
  image?: { quality: string; link: string };
  mediaUrls?: Array<{ quality: string; link: string }>;
  language?: string;
  year?: string;
  type?: string;
  [key: string]: any;
}

export interface SpotifyToSaavnMatch {
  spotify: SpotifyTrack;
  saavn: SaavnCandidate | null;
  score: number;
  /** True when score >= MIN_ACCEPT_SCORE and we picked a candidate. */
  matched: boolean;
  /** The query string that produced the winning candidate (for debugging). */
  query: string;
  /** Total candidates the Saavn search returned. */
  candidatesConsidered: number;
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  const inter = [...ta].filter((t) => tb.has(t));
  const union = new Set([...ta, ...tb]);
  const jaccard = union.size === 0 ? 0 : inter.length / union.size;
  const overlap = inter.join('').length / Math.max(a.replace(/ /g, '').length, 1);
  return jaccard * 0.7 + overlap * 0.3;
}

function artistMatch(spotifyArtists: string[], saavnArtistsRaw: string): number {
  const saavn = saavnArtistsRaw
    .split(',')
    .map((s) => norm(s))
    .filter(Boolean);
  if (spotifyArtists.length === 0) return 0;
  let hits = 0;
  for (const a of spotifyArtists) {
    if (saavn.includes(norm(a))) hits++;
  }
  return hits / spotifyArtists.length;
}

function score(spotify: SpotifyTrack, cand: SaavnCandidate): number {
  const t = titleSimilarity(spotify.name, cand.title || cand.name || '');
  const a = artistMatch(spotify.artists, cand.primaryArtists || cand.music || cand.singers || '');
  // Saavn ships duration in seconds (as a string sometimes). Convert and
  // compare against Spotify's ms with a linear-decay penalty.
  const durSpotify = spotify.durationMs || 0;
  const durCand = (cand.duration && parseInt(String(cand.duration), 10) * 1000) || 0;
  let d = 0.5; // neutral baseline when we can't compare
  if (durSpotify > 0 && durCand > 0) {
    const ratio = Math.abs(durSpotify - durCand) / Math.max(durSpotify, 1);
    d = Math.max(0, 1 - ratio);
  }
  return t * 0.55 + a * 0.3 + d * 0.15;
}

/** Build the candidate query strings to try, in order of specificity.
 *  Most matches land on the first one; the variants are fallbacks for
 *  the ~5% with extra annotations or noisy artist lists. */
function buildQueries(t: SpotifyTrack): string[] {
  const cleaned = t.name
    .replace(/-\s*from\s+"[^"]+"/i, '')
    .replace(/\(.*?version\)/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/["“”]/g, '')
    .replace(/-\s*remix.*/i, '')
    .replace(/feat\..*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const primaryArtist = t.artists[0] || '';
  const twoArtists = t.artists.slice(0, 2).join(' ');
  const queries = [
    `${cleaned} ${twoArtists}`.trim(),
    `${cleaned} ${primaryArtist}`.trim(),
    cleaned,
  ];
  // De-dup while preserving order.
  return queries.filter((v, i, arr) => v && arr.indexOf(v) === i);
}

async function saavnSearch(q: string): Promise<SaavnCandidate[]> {
  try {
    // `getSaavnSearchData(_, 'songs')` returns `{ heading, list, source, count }`
    // but the function's union return type loses that — cast through any.
    const res = (await getSaavnSearchData(q, 'songs', 1, 10)) as any;
    if (res && Array.isArray(res.list)) return res.list as SaavnCandidate[];
    return [];
  } catch {
    return [];
  }
}

async function matchOne(spotify: SpotifyTrack): Promise<SpotifyToSaavnMatch> {
  // 1) Persistent cache
  try {
    const cached = (await cache.get(MATCH_CACHE_KEY(spotify.id))) as SpotifyToSaavnMatch | null;
    if (cached) return { ...cached, spotify }; // refresh the spotify side from current input
  } catch {
    /* cache offline — go live */
  }

  // 2) ISRC-as-query (cheap; skip when we don't have one).
  let best: SaavnCandidate | null = null;
  let bestScore = -1;
  let bestQuery = '';
  let candidatesConsidered = 0;

  if (spotify.isrc) {
    const isrcHits = await saavnSearch(spotify.isrc);
    candidatesConsidered += isrcHits.length;
    for (const c of isrcHits) {
      const s = score(spotify, c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
        bestQuery = `isrc:${spotify.isrc}`;
      }
    }
  }

  // 3) Cleaned title + artist fuzzy. We always run this even after an
  //    ISRC hit so the scoring can pick the best between them — ISRC
  //    sometimes lands on a weird live/karaoke version.
  for (const q of buildQueries(spotify)) {
    const hits = await saavnSearch(q);
    candidatesConsidered += hits.length;
    for (const c of hits) {
      const s = score(spotify, c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
        bestQuery = q;
      }
    }
    // First non-empty fuzzy result is usually the best — bail to save
    // a couple of calls per track. (ISRC pass above sets best already
    // if it found anything; this is the early-out for the fuzzy ladder.)
    if (hits.length > 0) break;
  }

  const matched = best !== null && bestScore >= MIN_ACCEPT_SCORE;
  const out: SpotifyToSaavnMatch = {
    spotify,
    saavn: best,
    score: bestScore < 0 ? 0 : bestScore,
    matched,
    query: bestQuery,
    candidatesConsidered,
  };

  // 4) Persist whether matched or not — even a known-miss saves us
  //    re-running the full ladder next time someone imports the same
  //    track. (We only cache when at least one search ran, so transient
  //    failures don't poison the cache.)
  if (candidatesConsidered > 0 || best === null) {
    try {
      await cache.set(MATCH_CACHE_KEY(spotify.id), out, MATCH_CACHE_TTL);
    } catch {
      /* cache write blip — return anyway */
    }
  }
  return out;
}

/**
 * Match a list of Spotify tracks to Saavn songs in batched parallel.
 *
 * Why batching: Saavn isn't on our rate-limit list, but searching 200
 * tracks at once still bursts hard against their CDN. 8 in flight is a
 * polite middle ground — empirically delivers the full 100-track
 * playlist in ~2 s while keeping the upstream calm.
 */
export async function matchTracks(
  tracks: SpotifyTrack[],
  opts: { concurrency?: number } = {},
): Promise<SpotifyToSaavnMatch[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16));
  const out: SpotifyToSaavnMatch[] = new Array(tracks.length);
  let idx = 0;
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= tracks.length) return;
      out[i] = await matchOne(tracks[i]);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, worker);
  await Promise.all(workers);
  return out;
}
