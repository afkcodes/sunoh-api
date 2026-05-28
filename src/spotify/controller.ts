// Spotify playlist import endpoint.
//
//   GET /spotify/import?url=<spotify-playlist-url>
//
// Pulls a public playlist through Spotify's Web API, maps each track to
// the closest Saavn song, and returns the merged result in a single
// response. Replaces the old Puppeteer-driven scrape + queued-job
// machinery (~950 LOC across spotify_import/, queue/, mappers/) with
// ~70 LOC of plumbing on top of `playlist.ts` + `match.ts`.

import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendError, sendSuccess } from '../utils/response';
import { matchTracks } from './match';
import { extractPlaylistId, fetchSpotifyPlaylist } from './scraper';

const SOURCE = 'spotify';

interface ImportQuery {
  url?: string;
}

/**
 * Single endpoint, sync. Fast because the actual work — Spotify pull +
 * Saavn matching — totals ~2 s for a 100-track playlist and scales
 * linearly past that (Spotify pages at 100, match runs 8-wide).
 *
 * The old async-queued path (jobs / status polling / queue stats) is
 * gone: there's no scenario where 2–5 s of sync execution justifies a
 * jobId + polling protocol for a private app with one user.
 */
export const importPlaylistController = async (
  req: FastifyRequest<{ Querystring: ImportQuery }>,
  res: FastifyReply,
) => {
  const url = req.query.url;
  if (!url) return sendError(res, 'Missing required parameter: url', null, 400);

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return sendError(res, 'Could not extract a Spotify playlist id from the input', null, 400);
  }

  const playlist = await fetchSpotifyPlaylist(playlistId);
  if (!playlist) {
    return sendError(
      res,
      'Failed to fetch playlist from Spotify (private, removed, or upstream error)',
      null,
      502,
    );
  }

  const items = await matchTracks(playlist.tracks);

  const matched = items.filter((m) => m.matched).length;
  const unmatched = items.length - matched;

  return sendSuccess(
    res,
    {
      source: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        owner: playlist.owner,
        followers: playlist.followers,
        artworkUrl: playlist.artworkUrl,
        url: playlist.url,
        trackCount: playlist.trackCount,
      },
      summary: {
        total: items.length,
        matched,
        unmatched,
      },
      items,
    },
    `Imported "${playlist.name}" — ${matched}/${items.length} matched on Saavn`,
    SOURCE,
  );
};
