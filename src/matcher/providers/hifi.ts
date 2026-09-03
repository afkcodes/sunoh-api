import { extractVersion, splitArtists } from '../text';
import type { CanonicalTrack } from '../types';

/**
 * Lossless catalogue lookup via the community HiFi API instances.
 *
 * These instances expose the Tidal catalogue as plain JSON with no credentials,
 * which is what makes them useful here: every record carries an `isrc`, an
 * exact `duration`, and a `mediaMetadata.tags` list that says whether a hi-res
 * tier exists. That is enough to answer "is this track available lossless, and
 * which recording is it" without touching any stream.
 *
 * Only catalogue metadata is read. Stream resolution is deliberately not
 * implemented here.
 */

const DEFAULT_INSTANCES = [
  'https://monochrome-api.samidy.com',
  'https://lol.samidy.workers.dev',
];

/** Override with a comma-separated list. */
function instances(): string[] {
  const configured = (process.env.HIFI_INSTANCES ?? '').trim();
  if (configured) {
    return configured
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  }
  return DEFAULT_INSTANCES;
}

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.HIFI_TIMEOUT_MS ?? '9000', 10);

/**
 * Remembers which instance answered last so a healthy one is tried first.
 * Reset on failure so a dead instance is not pinned.
 */
let preferred: string | null = null;

interface TidalSearchResponse {
  version?: string;
  data?: { items?: Array<Record<string, unknown>> };
  items?: Array<Record<string, unknown>>;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Map a raw Tidal track record into the canonical shape. */
export function fromTidal(raw: Record<string, unknown>): CanonicalTrack {
  const album = obj(raw.album);
  const rawTitle = str(raw.title) ?? '';
  const version = str(raw.version);
  // Tidal keeps the version marker in its own field, so it is folded back into
  // the title before parsing to keep remix detection working.
  const fullTitle = version ? `${rawTitle} (${version})` : rawTitle;
  const parts = extractVersion(fullTitle);

  const artistList = raw.artists;
  const names: string[] = Array.isArray(artistList)
    ? artistList.flatMap((a) => splitArtists(str(obj(a).name) ?? ''))
    : splitArtists(str(obj(raw.artist).name) ?? '');

  const tags = (obj(raw.mediaMetadata).tags as string[] | undefined) ?? [];
  const quality = str(raw.audioQuality) ?? '';
  const hires = tags.includes('HIRES_LOSSLESS') || quality === 'HI_RES' || quality === 'HI_RES_LOSSLESS';

  const cover = str(album.cover);

  return {
    source: 'tidal',
    sourceId: raw.id !== undefined ? String(raw.id) : undefined,
    title: parts.base || rawTitle,
    rawTitle: fullTitle,
    version: parts.version,
    artists: Array.from(new Set(names)),
    album: str(album.title),
    albumId: album.id !== undefined ? String(album.id) : undefined,
    year: num(String(str(raw.streamStartDate) ?? str(album.releaseDate) ?? '').slice(0, 4)),
    durationSec: num(raw.duration),
    isrc: str(raw.isrc),
    coverUrl: cover ? `https://resources.tidal.com/images/${cover.replace(/-/g, '/')}/1280x1280.jpg` : undefined,
    explicit: Boolean(raw.explicit),
    trackNumber: num(raw.trackNumber),
    discNumber: num(raw.volumeNumber),
    popularity: num(raw.popularity),
    hires,
    // Prefer the richer tag list over the coarse audioQuality field.
    quality: tags.includes('HIRES_LOSSLESS') ? 'HIRES_LOSSLESS' : (tags[0] ?? (quality || undefined)),
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<TidalSearchResponse | null> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(url, {
      signal: combined,
      headers: {
        Accept: 'application/json',
        // Some instances only answer requests that look like they came from
        // the web client they were built for.
        'User-Agent': 'Mozilla/5.0 (compatible; sunoh-api/1.0)',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as TidalSearchResponse;
  } catch {
    return null;
  }
}

/**
 * Search the lossless catalogue, failing over between instances.
 * Returns [] when every instance is unreachable rather than throwing, so a
 * matcher call degrades to "not available" instead of erroring the request.
 */
export async function search(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<CanonicalTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const pool = instances();
  const ordered = preferred ? [preferred, ...pool.filter((i) => i !== preferred)] : pool;

  for (const base of ordered) {
    const url = `${base}/search/?s=${encodeURIComponent(trimmed)}`;
    const data = await fetchJson(url, opts.signal);
    const items = data?.data?.items ?? data?.items;
    if (!items || !Array.isArray(items)) continue;

    preferred = base;
    return items
      .map(fromTidal)
      .filter((t) => t.sourceId)
      .slice(0, opts.limit ?? 25);
  }

  // Every instance failed; forget the pinned one so the next call re-probes.
  preferred = null;
  return [];
}

/**
 * Look a track up by ISRC. The instances have no ISRC endpoint, so this
 * searches and filters, which still beats a title search when an ISRC is known.
 */
export async function searchByIsrc(
  isrc: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CanonicalTrack[]> {
  const results = await search(isrc, { limit: 25, signal: opts.signal });
  const exact = results.filter((r) => (r.isrc ?? '').toUpperCase() === isrc.toUpperCase());
  return exact.length > 0 ? exact : results;
}

/** Current instance pool and which one last answered, for a health endpoint. */
export function status(): { instances: string[]; preferred: string | null } {
  return { instances: instances(), preferred };
}

/**
 * Discovery: related artists and albums.
 *
 * These are catalogue relationships, not streams, so they work without any
 * subscription behind the instance -- unlike /track/, which returns a
 * 30-second PREVIEW with `previewReason: FULL_REQUIRES_SUBSCRIPTION`.
 */

export interface RelatedArtist {
  id?: string;
  name?: string;
  popularity?: number;
  picture?: string;
}

export interface RelatedAlbum {
  id?: string;
  title?: string;
  artist?: string;
  year?: number;
  cover?: string;
  numberOfTracks?: number;
}

function tidalImage(id: string | undefined, size: string): string | undefined {
  return id ? `https://resources.tidal.com/images/${id.replace(/-/g, '/')}/${size}.jpg` : undefined;
}

async function firstOk<T>(path: string, pick: (d: any) => T[] | undefined, signal?: AbortSignal): Promise<T[]> {
  const pool = instances();
  const ordered = preferred ? [preferred, ...pool.filter((i) => i !== preferred)] : pool;
  for (const base of ordered) {
    const data = await fetchJson(`${base}${path}`, signal);
    const items = data ? pick(data) : undefined;
    if (Array.isArray(items)) {
      preferred = base;
      return items;
    }
  }
  return [];
}

export async function similarArtists(
  artistId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<RelatedArtist[]> {
  const items = await firstOk<Record<string, unknown>>(
    `/artist/similar/?id=${encodeURIComponent(artistId)}`,
    (d) => d?.artists ?? d?.data?.items ?? d?.items,
    opts.signal,
  );
  return items.map((a) => ({
    id: a.id !== undefined ? String(a.id) : undefined,
    name: str(a.name),
    popularity: num(a.popularity),
    picture: tidalImage(str(a.picture), '750x750'),
  }));
}

export async function similarAlbums(
  albumId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<RelatedAlbum[]> {
  const items = await firstOk<Record<string, unknown>>(
    `/album/similar/?id=${encodeURIComponent(albumId)}`,
    (d) => d?.albums ?? d?.data?.items ?? d?.items,
    opts.signal,
  );
  return items.map((a) => {
    // Album records credit via an `artists` array; the singular `artist` field
    // is present but null. Track count is `numberOfItems`.
    const credited = Array.isArray(a.artists) ? a.artists : [];
    return {
      id: a.id !== undefined ? String(a.id) : undefined,
      title: str(a.title),
      artist: str(obj(credited[0]).name) ?? str(obj(a.artist).name),
      year: num(String(str(a.releaseDate) ?? '').slice(0, 4)),
      cover: tidalImage(str(a.cover), '1280x1280'),
      numberOfTracks: num(a.numberOfItems) ?? num(a.numberOfTracks),
    };
  });
}
