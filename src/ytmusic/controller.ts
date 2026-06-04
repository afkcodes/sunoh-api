// YouTube Music endpoints.
//
// `GET /ytmusic/search?q=…&filter=songs` — text search, returns flat
//   list of FeedItem-shaped song rows. Cached 10 min per query.
//
// Stream URL resolution intentionally NOT here: /player from a
// datacenter IP triggers YouTube's "Sign in to confirm you're not a
// bot" check (LOGIN_REQUIRED). The Flutter side hits InnerTube
// directly from the device — see lib/api/ytmusic_player.dart.

import type { FastifyReply, FastifyRequest } from 'fastify';

import { cache } from '../redis';
import { sendError, sendSuccess } from '../utils/response';
import { search } from './client';
import { extractSongResults, mapSongToFeedItem } from './mappers';

const SOURCE = 'youtube_music';

const SEARCH_KEY = (q: string, filter: string) => `ytmusic_search_${filter}_${q.toLowerCase()}_v1`;
const SEARCH_TTL = 60 * 10; // 10 min

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
