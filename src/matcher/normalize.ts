import { extractVersion, parseLabel, parseSubtitle, splitArtists } from './text';
import type { CanonicalTrack, CatalogSource } from './types';

/**
 * Normalization for the app's unified `Song` shape.
 *
 * Saavn and Gaana both map to the same `Song` interface (see src/types), so one
 * normalizer covers both. The two do differ in one place that matters:
 *
 *   Saavn   subtitle = "Pritam, Mika Singh, Shefali Alvares - Desi Boyz"
 *   Gaana   subtitle = "Pritam, Mika Singh, Shefali Alvares"
 *
 * Gaana builds its subtitle from the artist list alone with no album suffix, so
 * splitting on the last " - " would be wrong there and is only done for Saavn.
 */

/** The fields of the app's Song type this module actually reads. */
export interface SongLike {
  id?: string;
  songId?: string;
  title?: string;
  name?: string;
  song?: string;
  subtitle?: string;
  image?: unknown;
  language?: string;
  year?: string | number;
  duration?: string | number;
  playCount?: string | number;
  artists?: unknown;
  album?: { id?: string; name?: string; url?: string } | string;
  hasLyrics?: boolean;
  copyright?: string;
  releaseDate?: string | null;
  source?: string;
  [key: string]: unknown;
}

/** Saavn double-encodes entities in titles. */
export function decodeEntities(input: string | null | undefined): string {
  if (!input) return '';
  let out = String(input);
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&nbsp;/gi, ' ');
  }
  return out.trim();
}

function toInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

function pickLargestImage(image: unknown): string | undefined {
  if (typeof image === 'string') return image || undefined;
  if (!Array.isArray(image)) return undefined;
  let best: string | undefined;
  let bestPx = -1;
  for (const entry of image) {
    if (!entry || typeof entry !== 'object') continue;
    const link = (entry as Record<string, unknown>).link ?? (entry as Record<string, unknown>).url;
    if (typeof link !== 'string' || !link) continue;
    const quality = String((entry as Record<string, unknown>).quality ?? '');
    const px = toInt(quality.split('x')[0]) ?? 0;
    if (px >= bestPx) {
      bestPx = px;
      best = link;
    }
  }
  return best;
}

/**
 * Names from the structured `artists` array.
 *
 * Deliberately a fallback rather than the primary source: on Saavn this array
 * mixes musicians with the film cast. For "Sun Saathiya" it holds two actors
 * and omits one of the singers, while the subtitle lists all three singers and
 * no cast. Measured over 40 real tracks, matching on the subtitle scored ~6
 * points higher on average with identical accuracy.
 */
function namesFromArray(list: unknown): string[] {
  if (!list) return [];
  if (typeof list === 'string') return splitArtists(list);
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      out.push(...splitArtists(entry));
      continue;
    }
    if (entry && typeof entry === 'object') {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === 'string' && name) out.push(...splitArtists(decodeEntities(name)));
    }
  }
  return Array.from(new Set(out));
}

/** Normalize one Song from any of the app's providers. */
export function fromSong(song: SongLike): CanonicalTrack {
  const rawSource = String(song.source ?? '').toLowerCase();
  const source: CatalogSource = rawSource === 'gaana' ? 'gaana' : 'saavn';

  const rawTitle = decodeEntities(song.title ?? song.song ?? song.name ?? '');
  const parts = extractVersion(rawTitle);

  const subtitle = decodeEntities(song.subtitle);
  // Gaana's subtitle carries no album, so it is read as artists only.
  const sub =
    source === 'gaana'
      ? { artists: splitArtists(subtitle), album: undefined as string | undefined }
      : parseSubtitle(subtitle);

  let artists = sub.artists;
  if (artists.length === 0) artists = namesFromArray(song.artists);
  artists = Array.from(new Set(artists));

  const albumRaw = song.album;
  const album =
    typeof albumRaw === 'string'
      ? decodeEntities(albumRaw)
      : decodeEntities(albumRaw?.name) || sub.album;

  const releaseDate = song.releaseDate;
  const year =
    toInt(song.year) ?? (releaseDate ? toInt(String(releaseDate).slice(0, 4)) : undefined);

  return {
    source,
    sourceId: song.id ?? song.songId,
    title: parts.base || rawTitle,
    rawTitle,
    version: parts.version,
    artists,
    album: album || undefined,
    albumId: typeof albumRaw === 'object' ? albumRaw?.id : undefined,
    year,
    durationSec: toInt(song.duration),
    language: song.language ? String(song.language).toLowerCase() : undefined,
    label: parseLabel(song.copyright),
    coverUrl: pickLargestImage(song.image),
    popularity: toInt(song.playCount),
  };
}

/**
 * Unwrap whatever the caller posted into a list of songs: a bare song, an
 * array, a `{ list }`, or the API's own `{ status, data: { list } }` envelope.
 */
export function extractSongs(payload: unknown): SongLike[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as SongLike[];
  if (typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;

  const data = record.data;

  // Gaana answers with an array of sections -- [{ heading, data: [...] }] --
  // while Saavn answers with a single { heading, list: [...] }. Both are
  // flattened here so a caller can forward either verbatim.
  if (Array.isArray(data)) {
    const collected: SongLike[] = [];
    for (const section of data) {
      const inner = (section as Record<string, unknown>)?.data ?? (section as Record<string, unknown>)?.list;
      if (Array.isArray(inner)) {
        for (const item of inner) {
          if ((item as Record<string, unknown>)?.type === 'song') collected.push(item as SongLike);
        }
      } else if ((section as Record<string, unknown>)?.type === 'song') {
        collected.push(section as SongLike);
      }
    }
    if (collected.length > 0) return collected;
  }

  if (data && typeof data === 'object') {
    const inner = data as Record<string, unknown>;

    // A detail endpoint returns the song itself as `data`.
    if (inner.type === 'song' || inner.title || inner.song) return [inner as SongLike];

    const list = inner.list;
    if (Array.isArray(list)) return list as SongLike[];
    for (const value of Object.values(inner)) {
      if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).list)) {
        return (value as Record<string, unknown>).list as SongLike[];
      }
    }
  }

  for (const key of ['list', 'results', 'songs', 'items']) {
    const value = record[key];
    if (Array.isArray(value)) return value as SongLike[];
  }

  if (record.title || record.song || record.name) return [record as SongLike];
  return [];
}
