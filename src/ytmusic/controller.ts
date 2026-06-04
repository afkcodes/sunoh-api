// YouTube Music endpoints.
//
// `GET /ytmusic/search?q=…&filter=songs` — text search, returns flat
//   list of FeedItem-shaped song rows. Cached 10 min per query.
//
// `GET /ytmusic/song/:videoId/stream` — resolves the best audio-only
//   googlevideo URL via InnerTube `/player`, then returns a proxy URL
//   that points BACK at sunoh-api. Direct googlevideo URLs include
//   `&ip=<requester-IP>` and 403 from any other client IP, so the
//   resolver hands back something the Flutter audio engine can
//   actually fetch from the phone.
//
// `GET /ytmusic/audio/:videoId` — the actual byte proxy. Fetches the
//   resolved googlevideo URL from the VPS, streams the response back
//   to the caller (with Range-header passthrough so the audio engine
//   can pre-buffer + seek). Bandwidth cost is borne by the VPS; for
//   2 users at ~5 MB/song this is trivial.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { cache } from '../redis';
import { sendError, sendSuccess } from '../utils/response';
import { player, search } from './client';
import { extractSongResults, mapSongToFeedItem, pickBestAudioFormat } from './mappers';
import type { YtPlayerResponse } from './types';

const SOURCE = 'youtube_music';

const SEARCH_KEY = (q: string, filter: string) => `ytmusic_search_${filter}_${q.toLowerCase()}_v1`;
const SEARCH_TTL = 60 * 10; // 10 min
// Cache key bumped v2 → v3 after the ANDROID experiment: ANDROID
// briefly resolved Opus 160 then started 400'ing with "Precondition
// check failed"; the brief-success cached URLs were ANDROID-signed
// and 403 from the proxy fetch. Bumping flushes those poisoned
// entries so post-revert IOS resolves populate the new key fresh.
const STREAM_KEY = (videoId: string) => `ytmusic_stream_${videoId}_v3`;
const STREAM_TTL = 60 * 4; // 4 min — conservative; YT URLs live ~6 h

/** Public base URL the audio-proxy endpoint announces to clients.
 *  Configurable via env so the response works from local dev (where
 *  the API is at `http://10.0.2.2:3600`) AND production
 *  (`https://api.sunoh.online`). Default matches the prod hostname. */
const PUBLIC_BASE_URL =
  process.env.SUNOH_API_PUBLIC_URL?.replace(/\/+$/, '') || 'https://api.sunoh.online';

const proxyUrlFor = (videoId: string): string =>
  `${PUBLIC_BASE_URL}/ytmusic/audio/${encodeURIComponent(videoId)}`;

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

// ── Shared resolve → cache helper ───────────────────────────────────────
//
// Used by /stream (returns the client-facing payload) AND /audio (needs
// the raw googlevideo URL to proxy from). One place that owns the
// resolve + cache logic so both endpoints stay in sync.

interface StreamResolveResult {
  /** Raw googlevideo URL — IP-bound to the VPS. NEVER returned to the
   *  client; only used internally by the /audio proxy. */
  googlevideoUrl: string;
  mimeType: string;
  bitrate: number;
  /** Epoch seconds the URL is expected to remain valid until. Read
   *  from YouTube's `streamingData.expiresInSeconds`. */
  expiresAt: number;
  title?: string;
  artist?: string;
  durationSeconds?: number;
}

class StreamResolveError extends Error {
  constructor(
    public httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

async function resolveStream(videoId: string): Promise<StreamResolveResult> {
  // Cached resolved URLs are cheap and (usually) still valid up to
  // ~6 h. The Flutter resolver re-asks if playback errors out, so a
  // short 4-min cache is safe.
  try {
    const cached = await cache.get<StreamResolveResult>(STREAM_KEY(videoId));
    if (cached && cached.expiresAt > Math.floor(Date.now() / 1000) + 30) {
      return cached;
    }
  } catch {
    /* cache offline */
  }

  const upstream = await player(videoId);
  if (!upstream.ok || !upstream.data) {
    throw new StreamResolveError(502, upstream.error || 'Player fetch failed');
  }
  const resp = upstream.data as YtPlayerResponse;
  const status = resp.playabilityStatus?.status;
  if (status && status !== 'OK') {
    throw new StreamResolveError(
      403,
      `Track not playable: ${status} (${resp.playabilityStatus?.reason ?? ''})`.trim(),
    );
  }
  const fmt = pickBestAudioFormat(resp);
  if (!fmt?.url) {
    throw new StreamResolveError(502, 'No audio formats returned');
  }

  const expiresInSec = Number(resp.streamingData?.expiresInSeconds ?? 0) || 21600;
  const result: StreamResolveResult = {
    googlevideoUrl: fmt.url,
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
  return result;
}

// ── GET /ytmusic/song/:videoId/stream ───────────────────────────────────
//
// Client-facing resolver. Returns the public proxy URL pointing back
// at sunoh-api, NOT the raw googlevideo URL. Direct googlevideo URLs
// are IP-bound to the requesting host and 403 from the client device.

export const ytmusicStreamController = async (req: FastifyRequest, res: FastifyReply) => {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    return sendError(res, 'Missing path param `videoId`', null, 400);
  }
  try {
    const result = await resolveStream(videoId);
    return sendSuccess(
      res,
      {
        url: proxyUrlFor(videoId),
        mimeType: result.mimeType,
        bitrate: result.bitrate,
        expiresAt: result.expiresAt,
        title: result.title,
        artist: result.artist,
        durationSeconds: result.durationSeconds,
      },
      'YT Music stream',
      SOURCE,
    );
  } catch (e: unknown) {
    const err = e as StreamResolveError;
    return sendError(res, err.message ?? 'Resolve failed', null, err.httpStatus ?? 502);
  }
};

// ── GET /ytmusic/audio/:videoId — byte proxy ─────────────────────────────
//
// Streams the actual audio bytes from googlevideo to the client.
// Range header passes through so the audio engine can pre-buffer +
// seek as usual. All bandwidth goes through the VPS — for 2 users at
// ~5 MB per song this is well within budget.

export const ytmusicAudioProxyController = async (req: FastifyRequest, res: FastifyReply) => {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    return sendError(res, 'Missing path param `videoId`', null, 400);
  }
  let result: StreamResolveResult;
  try {
    result = await resolveStream(videoId);
  } catch (e: unknown) {
    const err = e as StreamResolveError;
    return sendError(res, err.message ?? 'Resolve failed', null, err.httpStatus ?? 502);
  }

  // Forward the client's Range header so partial-content requests
  // (audio engine pre-buffer + seek) work through the proxy.
  const range = req.headers.range as string | undefined;
  const upstreamReq = await fetch(result.googlevideoUrl, {
    headers: range ? { range } : {},
    // No abort signal — let the audio engine close the connection
    // by terminating the response (Fastify hooks the socket close
    // into the readable stream).
  });

  if (!upstreamReq.ok && upstreamReq.status !== 206) {
    return sendError(
      res,
      `Upstream googlevideo ${upstreamReq.status}`,
      null,
      upstreamReq.status === 403 || upstreamReq.status === 404 ? upstreamReq.status : 502,
    );
  }

  // Mirror status (200 / 206 partial-content), pass through the
  // headers the audio engine reads. Don't forward upstream's
  // `transfer-encoding` — Fastify will set its own on the response.
  res.code(upstreamReq.status);
  const passHeaders = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
  ];
  for (const h of passHeaders) {
    const v = upstreamReq.headers.get(h);
    if (v) res.header(h, v);
  }
  if (!upstreamReq.headers.get('accept-ranges')) {
    res.header('accept-ranges', 'bytes');
  }

  if (!upstreamReq.body) {
    return sendError(res, 'Upstream returned no body', null, 502);
  }
  // Convert WHATWG → Node Readable and let Fastify pipe it.
  return res.send(Readable.fromWeb(upstreamReq.body as WebReadableStream));
};
