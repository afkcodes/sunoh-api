import { FastifyReply, FastifyRequest } from 'fastify';
import { cache } from '../redis';
import { sendError, sendSuccess } from '../utils/response';
import { matchSong, matchSongs } from './match';
import { extractSongs, fromSong, type SongLike } from './normalize';
import * as hifi from './providers/hifi';
import type { LosslessMatch } from './types';

/**
 * Lossless availability lookup.
 *
 * Takes the app's own unified `Song` object, exactly as /saavn and /gaana
 * already return it, and reports whether the same recording exists in the
 * lossless catalogue. Nothing new for the client to construct: forward the
 * song you already have.
 */

/**
 * A track's identity does not change, and neither does whether the lossless
 * catalogue carries it, so a long TTL is safe. A miss is cached for less time
 * so a catalogue addition is picked up within the day.
 */
const HIT_TTL = 60 * 60 * 24 * 30;
const MISS_TTL = 60 * 60 * 12;

const cacheKey = (song: SongLike): string => {
  const source = String(song.source ?? 'saavn').toLowerCase();
  const id = String(song.id ?? song.songId ?? '');
  // Fall back to a content key when the record has no id at all.
  const key = id || `${song.title ?? ''}|${song.duration ?? ''}`;
  return `lossless_match_v1_${source}_${key}`;
};

async function matchWithCache(song: SongLike): Promise<LosslessMatch> {
  const key = cacheKey(song);
  const cached = await cache.get<LosslessMatch>(key);
  if (cached) return { ...cached, elapsedMs: 0 };

  const result = await matchSong(song);
  await cache.set(key, result, result.lossless ? HIT_TTL : MISS_TTL);
  return result;
}

interface MatchBody {
  song?: unknown;
  songs?: unknown;
}

/**
 * POST /match/lossless
 *
 * Body accepts whichever of these the client already has:
 *   { "song":  <Song> }                        one track
 *   { "songs": [<Song>, ...] }                 many tracks
 *   { "song":  <search response envelope> }    a whole /saavn/search body
 */
export const losslessMatchController = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = (req.body ?? {}) as MatchBody;

    // `songs` wins when both are present; otherwise unwrap whatever `song` is.
    const songs: SongLike[] = body.songs
      ? extractSongs(body.songs)
      : extractSongs(body.song);

    if (songs.length === 0) {
      return sendError(res, 'Provide a `song` object or a `songs` array.', null, 400);
    }

    if (songs.length === 1) {
      const result = await matchWithCache(songs[0]!);
      return sendSuccess(res, result, 'Lossless match resolved', 'matcher');
    }

    const capped = songs.slice(0, 100);
    const results = await Promise.all(capped.map(matchWithCache));
    const found = results.filter((r) => r.lossless).length;

    return sendSuccess(
      res,
      {
        total: capped.length,
        matched: found,
        // Say so explicitly rather than silently returning a short list.
        truncated: songs.length > capped.length ? songs.length - capped.length : 0,
        results,
      },
      `Matched ${found} of ${capped.length}`,
      'matcher',
    );
  } catch (err) {
    return sendError(res, 'Lossless match failed', err instanceof Error ? err.message : String(err), 500);
  }
};

/**
 * POST /match/normalize
 *
 * Normalization only, so the shape the matcher reads can be inspected without
 * running a lookup. Useful when a track matches oddly.
 */
export const normalizeController = async (req: FastifyRequest, res: FastifyReply) => {
  const body = (req.body ?? {}) as MatchBody;
  const songs = extractSongs(body.songs ?? body.song);
  if (songs.length === 0) return sendError(res, 'Provide a `song` object or a `songs` array.', null, 400);
  const tracks = songs.map(fromSong);
  return sendSuccess(res, tracks.length === 1 ? tracks[0] : tracks, 'Normalized', 'matcher');
};

/** GET /match/status -- which lossless instances are configured and reachable. */
export const statusController = async (_req: FastifyRequest, res: FastifyReply) => {
  const { instances, preferred } = hifi.status();
  const probes = await Promise.all(
    instances.map(async (base) => {
      const started = Date.now();
      const results = await hifi.search('blinding lights', { limit: 1 });
      return { instance: base, ok: results.length > 0, latencyMs: Date.now() - started };
    }),
  );
  return sendSuccess(res, { preferred, instances: probes }, 'Matcher status', 'matcher');
};

/** DELETE /match/cache/:source/:id -- drop one cached verdict. */
export const clearCacheController = async (req: FastifyRequest, res: FastifyReply) => {
  const { source, id } = req.params as { source: string; id: string };
  await cache.delete(`lossless_match_v1_${source.toLowerCase()}_${id}`);
  return sendSuccess(res, { cleared: true }, 'Cache entry cleared', 'matcher');
};

/**
 * GET /match/similar/artist/:id and /match/similar/album/:id
 *
 * Catalogue relationships from the lossless catalogue. These need no
 * subscription behind the instance, unlike its stream endpoint.
 *
 * The `:id` is a Tidal id, which /match/lossless returns as `lossless.sourceId`
 * (artist ids are not returned yet, so pass one you already hold).
 */
const SIMILAR_TTL = 60 * 60 * 24 * 7;

export const similarArtistsController = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const key = `lossless_similar_artist_v1_${id}`;
  const cached = await cache.get(key);
  if (cached) return sendSuccess(res, cached, 'Similar artists (cached)', 'matcher');

  const artists = await hifi.similarArtists(id);
  if (artists.length > 0) await cache.set(key, artists, SIMILAR_TTL);
  return sendSuccess(res, artists, `Found ${artists.length} similar artists`, 'matcher');
};

export const similarAlbumsController = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const key = `lossless_similar_album_v1_${id}`;
  const cached = await cache.get(key);
  if (cached) return sendSuccess(res, cached, 'Similar albums (cached)', 'matcher');

  const albums = await hifi.similarAlbums(id);
  if (albums.length > 0) await cache.set(key, albums, SIMILAR_TTL);
  return sendSuccess(res, albums, `Found ${albums.length} similar albums`, 'matcher');
};

export { matchSongs };
