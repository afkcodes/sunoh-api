import { extractVersion, splitArtists } from '../text';
import type { CanonicalTrack } from '../types';

/**
 * MusicBrainz, used purely as an ISRC bridge.
 *
 * Saavn and Gaana do not publish ISRCs, and the lossless catalogue does. An
 * ISRC turns a fuzzy title match into an exact identity check, so it is worth
 * one lookup to obtain.
 */

const BASE = 'https://musicbrainz.org/ws/2';

/** MusicBrainz asks anonymous clients to stay at or below one request/second. */
const MIN_INTERVAL_MS = 1100;
let chain: Promise<void> = Promise.resolve();
let lastCall = 0;

function limited<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  chain = run.catch(() => undefined);
  return run.then(fn);
}

function headers(): Record<string, string> {
  const contact = process.env.MUSICBRAINZ_CONTACT ?? 'sunoh-api@example.com';
  return { 'User-Agent': `sunoh-api/1.0 ( ${contact} )`, Accept: 'application/json' };
}

/** Escape Lucene syntax so a title with quotes or colons still parses. */
function escapeLucene(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const timeout = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(url, { headers: headers(), signal: combined });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fromRecording(rec: Record<string, unknown>): CanonicalTrack {
  const rawTitle = String(rec.title ?? '');
  const parts = extractVersion(rawTitle);
  const lengthMs = typeof rec.length === 'number' ? rec.length : undefined;

  const credits = (rec['artist-credit'] as Array<Record<string, unknown>> | undefined) ?? [];
  const artists = credits
    .map((c) => {
      const artist = c.artist as Record<string, unknown> | undefined;
      const name = artist?.name ?? c.name;
      return typeof name === 'string' ? name : '';
    })
    .filter(Boolean)
    .flatMap((a) => splitArtists(a));

  const releases = (rec.releases as Array<Record<string, unknown>> | undefined) ?? [];
  const first = releases[0];
  const isrcs = rec.isrcs as string[] | undefined;

  return {
    source: 'musicbrainz',
    sourceId: typeof rec.id === 'string' ? rec.id : undefined,
    title: parts.base || rawTitle,
    rawTitle,
    version: parts.version,
    artists,
    album: typeof first?.title === 'string' ? first.title : undefined,
    year: Number.parseInt(String(first?.date ?? rec['first-release-date'] ?? '').slice(0, 4), 10) || undefined,
    durationSec: lengthMs ? Math.round(lengthMs / 1000) : undefined,
    isrc: isrcs?.[0],
  };
}

/**
 * Search recordings with a cascade of progressively looser queries.
 *
 * Artist is never a hard AND filter. In film music the source catalogue often
 * credits the composer first while MusicBrainz credits the singers, so
 * requiring an artist match drops the correct recording entirely.
 */
export async function searchRecordings(opts: {
  title: string;
  artists?: readonly string[];
  album?: string;
  limit?: number;
  signal?: AbortSignal;
  stopWhen?: (found: CanonicalTrack[]) => boolean;
}): Promise<CanonicalTrack[]> {
  const limit = opts.limit ?? 10;
  const title = escapeLucene(opts.title);
  const artists = (opts.artists ?? []).filter(Boolean);

  const attempts: string[] = [];
  if (opts.album) attempts.push(`recording:"${title}" AND release:"${escapeLucene(opts.album)}"`);
  if (artists.length > 0) {
    attempts.push(`recording:"${title}" AND (${artists.map((a) => `artist:"${escapeLucene(a)}"`).join(' OR ')})`);
  }
  attempts.push(`recording:"${title}"`);

  const seen = new Set<string>();
  const merged: CanonicalTrack[] = [];

  for (const query of attempts) {
    const url = `${BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
    const data = await limited(() =>
      getJson<{ recordings?: Array<Record<string, unknown>> }>(url, opts.signal),
    );
    for (const rec of data?.recordings ?? []) {
      const track = fromRecording(rec);
      const key = track.sourceId ?? `${track.title}|${track.durationSec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(track);
    }
    if (merged.length > 0 && opts.stopWhen?.(merged)) break;
  }

  return merged;
}

/** Fetch the ISRCs registered against one recording. */
export async function getRecordingIsrcs(mbid: string, signal?: AbortSignal): Promise<string[]> {
  const url = `${BASE}/recording/${encodeURIComponent(mbid)}?inc=isrcs&fmt=json`;
  const data = await limited(() => getJson<{ isrcs?: string[] }>(url, signal));
  return data?.isrcs ?? [];
}
