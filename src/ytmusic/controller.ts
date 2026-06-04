// YouTube Music endpoints — Phase 1 MVP.
//
// `GET /ytmusic/search?q=…&filter=songs` — text search, returns flat
//   list of FeedItem-shaped song rows. Cached 10 min per query.
//
// `GET /ytmusic/song/:videoId/stream` — resolves the best audio-only
//   stream URL via InnerTube `/player` with the IOS client type.
//   Cached 4 min (URLs expire ~6 h server-side, but IP-bound — a
//   conservative TTL keeps stale URLs out of the cache when sunoh-api
//   restarts on a different IP).

import type { FastifyReply, FastifyRequest } from 'fastify';

import { cache } from '../redis';
import { sendError, sendSuccess } from '../utils/response';
import { player, search } from './client';
import { extractSongResults, mapSongToFeedItem, pickBestAudioFormat } from './mappers';
import type { YtPlayerResponse } from './types';

const SOURCE = 'youtube_music';

const SEARCH_KEY = (q: string, filter: string) => `ytmusic_search_${filter}_${q.toLowerCase()}_v1`;
const SEARCH_TTL = 60 * 10; // 10 min
const STREAM_KEY = (videoId: string) => `ytmusic_stream_${videoId}_v1`;
const STREAM_TTL = 60 * 4; // 4 min — conservative; YT URLs live ~6 h

// ── GET /ytmusic/search ─────────────────────────────────────────────────

export const ytmusicSearchController = async (req: FastifyRequest, res: FastifyReply) => {
  const q = (req.query as { q?: string }).q?.trim() ?? '';
  if (q.length < 2) {
    return sendError(res, 'Search `q` must be ≥ 2 chars', null, 400);
  }
  const filter = (req.query as { filter?: string }).filter ?? 'songs';

  const key = SEARCH_KEY(q, filter);
  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
  } catch {
    /* cache offline → refetch */
  }

  const upstream = await search(q, filter as 'songs' | 'all');
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Search failed', null, 502);
  }
  const songs = extractSongResults(upstream.data);
  const list = songs.map(mapSongToFeedItem);
  const payload = { list, count: list.length };
  try {
    await cache.set(key, payload, SEARCH_TTL);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, payload, `YT Music search "${q}"`, SOURCE);
};

// ── GET /ytmusic/song/:videoId/stream ───────────────────────────────────

interface StreamResolveResult {
  url: string;
  mimeType: string;
  bitrate: number;
  /** Epoch seconds the URL is expected to remain valid until. Read
   *  from YouTube's `streamingData.expiresInSeconds`. */
  expiresAt: number;
  title?: string;
  artist?: string;
  durationSeconds?: number;
}

export const ytmusicStreamController = async (req: FastifyRequest, res: FastifyReply) => {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    return sendError(res, 'Missing path param `videoId`', null, 400);
  }

  // Cached resolved URLs are cheap to serve and (usually) still
  // valid up to ~6 h, but the Flutter resolver re-asks if playback
  // errors out so a short 4-min cache is safe. Refreshing too often
  // wastes upstream quota; refreshing too rarely risks a 403 mid-play.
  try {
    const cached = await cache.get<StreamResolveResult>(STREAM_KEY(videoId));
    if (cached && cached.expiresAt > Math.floor(Date.now() / 1000) + 30) {
      return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
    }
  } catch {
    /* cache offline */
  }

  const upstream = await player(videoId);
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Player fetch failed', null, 502);
  }
  const resp = upstream.data as YtPlayerResponse;
  const status = resp.playabilityStatus?.status;
  if (status && status !== 'OK') {
    return sendError(
      res,
      `Track not playable: ${status} (${resp.playabilityStatus?.reason ?? ''})`.trim(),
      null,
      403,
    );
  }
  const fmt = pickBestAudioFormat(resp);
  if (!fmt?.url) {
    return sendError(res, 'No audio formats returned', null, 502);
  }

  const expiresInSec = Number(resp.streamingData?.expiresInSeconds ?? 0) || 21600; // 6 h default
  const result: StreamResolveResult = {
    url: fmt.url,
    mimeType: fmt.mimeType,
    bitrate: fmt.averageBitrate ?? fmt.bitrate,
    expiresAt: Math.floor(Date.now() / 1000) + expiresInSec,
    title: resp.videoDetails?.title,
    artist: resp.videoDetails?.author,
    durationSeconds: resp.videoDetails?.lengthSeconds
      ? Number(resp.videoDetails.lengthSeconds)
      : undefined,
  };
  try {
    await cache.set(STREAM_KEY(videoId), result, STREAM_TTL);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, result, 'YT Music stream', SOURCE);
};
