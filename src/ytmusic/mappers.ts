// InnerTube response parsers + FeedItem mappers.
//
// The /search response is deeply nested under
// `contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content
//   .sectionListRenderer.contents[].musicShelfRenderer.contents[]`.
// Each leaf row is a `musicResponsiveListItemRenderer` whose
// `flexColumns` carry the title (col 0) + a pipe-separated artist /
// album / duration line (col 1). We walk that shape carefully — any
// renderer we don't recognise is dropped silently rather than
// crashing the whole search.
//
// Pure-TS port of the subset of OuterTune's pages/SearchResult.kt +
// models/MusicResponsiveListItemRenderer.kt we need for Phase 1.

import type { YtAdaptiveFormat, YtPlayerResponse, YtRun, YtThumbnail } from './types';

const SOURCE = 'youtube_music';

// ── Generic renderer-walking helpers ─────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function joinRuns(runs: YtRun[] | undefined | null): string {
  if (!Array.isArray(runs)) return '';
  return runs.map((r) => r?.text ?? '').join('');
}

function readRuns(node: unknown): YtRun[] {
  if (!isObj(node)) return [];
  const runs = (node as { runs?: unknown }).runs;
  return Array.isArray(runs) ? (runs as YtRun[]) : [];
}

function readThumbnails(node: unknown): YtThumbnail[] {
  if (!isObj(node)) return [];
  // Common shape: `thumbnail.musicThumbnailRenderer.thumbnail.thumbnails[]`
  // Also seen flat: `thumbnail.thumbnails[]`. Try both.
  const direct = (node as { thumbnails?: unknown }).thumbnails;
  if (Array.isArray(direct)) return direct as YtThumbnail[];
  const wrapped = (node as { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: unknown } } })
    .musicThumbnailRenderer?.thumbnail?.thumbnails;
  if (Array.isArray(wrapped)) return wrapped as YtThumbnail[];
  return [];
}

/** Pick the biggest thumbnail variant. InnerTube ships them
 *  smallest-first; sort defensively in case a future response
 *  re-orders. Returns null when the array is empty. */
function bestThumbnail(thumbs: YtThumbnail[]): string | null {
  if (thumbs.length === 0) return null;
  return [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url;
}

// ── Search result mapping ────────────────────────────────────────────────

/** One `musicResponsiveListItemRenderer` → FeedItem-shaped song row.
 *  Skips silently when required fields (videoId, title) are missing
 *  — keeps the search from blowing up on a single weird result. */
function mapSongRow(node: unknown): SongResult | null {
  if (!isObj(node)) return null;

  const videoId =
    (node.playlistItemData as { videoId?: string } | undefined)?.videoId ??
    (node.navigationEndpoint as { watchEndpoint?: { videoId?: string } } | undefined)?.watchEndpoint
      ?.videoId ??
    null;
  if (!videoId) return null;

  const flex = Array.isArray(node.flexColumns) ? node.flexColumns : [];

  const titleNode = (flex[0] as Record<string, unknown> | undefined)
    ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
  const title = joinRuns(readRuns(titleNode?.text));
  if (!title) return null;

  // Subtitle column: runs interleave "Artist", " • ", "Album", " • ",
  // "3:42". Pull the artist runs (those that carry a browseEndpoint
  // pointing at an artist channel), the album run (browseEndpoint
  // for an album), and the last numeric run as duration.
  const subNode = (flex[1] as Record<string, unknown> | undefined)
    ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
  const subRuns = readRuns(subNode?.text);
  const artists: { id: string | null; name: string }[] = [];
  let album: { id: string | null; name: string } | null = null;
  let duration: string | null = null;
  for (const r of subRuns) {
    const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
    if (browseId?.startsWith('UC') || browseId?.startsWith('MPLA')) {
      artists.push({ id: browseId, name: r.text });
    } else if (browseId?.startsWith('MPRE') || browseId?.startsWith('MPRH')) {
      album = { id: browseId, name: r.text };
    } else if (/^\d+:\d+/.test((r.text ?? '').trim())) {
      duration = r.text.trim();
    } else if (!browseId && r.text && r.text !== ' • ' && artists.length === 0) {
      // First non-separator run with no browseEndpoint — often an
      // unlinked artist name (covers, remixes). Treat as artist.
      artists.push({ id: null, name: r.text });
    }
  }

  const cover = bestThumbnail(readThumbnails(node.thumbnail));

  return {
    videoId,
    title,
    artists,
    album,
    duration,
    cover,
  };
}

export interface SongResult {
  videoId: string;
  title: string;
  artists: { id: string | null; name: string }[];
  album: { id: string | null; name: string } | null;
  /** Human-readable "3:42" string. Server-side; the Flutter resolver
   *  doesn't depend on a numeric form. */
  duration: string | null;
  cover: string | null;
}

/** Walk the /search response and pull every song-row out. Ignores
 *  the section structure — for Phase 1 we just want a flat list of
 *  songs that matched the query.
 *
 *  Future expansion: section-aware parser that returns
 *  { songs[], albums[], artists[], playlists[] }. */
export function extractSongResults(resp: unknown): SongResult[] {
  if (!isObj(resp)) return [];

  // Locate the section-list array, walking the renderer chain.
  const tabs = (resp as Record<string, unknown>).contents as
    | { tabbedSearchResultsRenderer?: { tabs?: unknown[] } }
    | undefined;
  const tab0 = tabs?.tabbedSearchResultsRenderer?.tabs?.[0] as
    | { tabRenderer?: { content?: { sectionListRenderer?: { contents?: unknown[] } } } }
    | undefined;
  const sections = tab0?.tabRenderer?.content?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return [];

  const out: SongResult[] = [];
  for (const section of sections) {
    if (!isObj(section)) continue;
    const shelf = section.musicShelfRenderer as { contents?: unknown[] } | undefined;
    if (!shelf?.contents) continue;
    for (const row of shelf.contents) {
      if (!isObj(row)) continue;
      const listItem = row.musicResponsiveListItemRenderer;
      if (!listItem) continue;
      const mapped = mapSongRow(listItem);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/** SongResult → FeedItem the Flutter side already renders. `type:
 *  'song'` so the existing track-row + queue + player handle YT
 *  results identically to Saavn/Gaana songs; `source: 'youtube_music'`
 *  routes the stream resolver to /ytmusic/song/:id/stream. */
export function mapSongToFeedItem(s: SongResult) {
  return {
    id: s.videoId,
    title: s.title,
    subtitle: s.artists.map((a) => a.name).join(', ') || null,
    type: 'song' as const,
    image: s.cover ? [{ quality: '500x500', link: s.cover }] : [],
    source: SOURCE,
    duration: s.duration,
    artists: s.artists.map((a) => ({ id: a.id ?? a.name, name: a.name })),
    album: s.album?.name,
    // mediaUrls intentionally empty — stream URLs live ~6 h and are
    // IP-bound, so we resolve on play not on search. Stream resolver
    // sees source=youtube_music → tier-2 call to /ytmusic/song/:id/stream.
  };
}

// ── /player response → playable stream URL ───────────────────────────────

/** Pick the best audio-only format from `streamingData.adaptiveFormats[]`.
 *  Just the highest-bitrate audio-only stream, regardless of codec.
 *  With the ANDROID client this typically lands on Opus 160 kbps
 *  (itag 251); IOS would top out at AAC 128 kbps (itag 140). Premium
 *  accounts get AAC 256 kbps (itag 141) when the request is
 *  authenticated — handled the same way, the picker doesn't need to
 *  special-case it.
 *
 *  mpv plays both Opus and AAC natively on every target platform,
 *  so we don't preference one codec over the other — bitrate wins. */
export function pickBestAudioFormat(resp: YtPlayerResponse): YtAdaptiveFormat | null {
  const all = resp.streamingData?.adaptiveFormats ?? [];
  const audio = all.filter((f) => f.mimeType?.startsWith('audio/') && f.url);
  if (audio.length === 0) return null;
  return audio.sort((a, b) => (b.averageBitrate ?? b.bitrate) - (a.averageBitrate ?? a.bitrate))[0];
}
