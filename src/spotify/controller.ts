import { FastifyReply, FastifyRequest } from 'fastify';
import { mapSpotifyPlaylist } from '../mappers/spotify.mapper';
import { addPlaylistMappingJob, getJobStatus, getQueueStats } from '../queue/playlistQueue';
import { extractPlaylistId, scrapePlaylist } from '../spotify_import/spotify_playlist';
import { sendError, sendSuccess } from '../utils/response';

interface PlaylistQuery {
  url?: string;
  fast?: string;
  debug?: string;
  limit?: string;
}

const playlistController = async (
  req: FastifyRequest<{ Querystring: PlaylistQuery }>,
  reply: FastifyReply,
) => {
  try {
    const { url, fast, debug } = req.query;

    if (!url) {
      return sendError(reply, 'Missing required parameter: url', null, 400);
    }

    if (!url.includes('spotify.com/playlist/')) {
      return sendError(
        reply,
        'Invalid URL: Please provide a valid Spotify playlist URL',
        null,
        400,
      );
    }

    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
      return sendError(reply, 'Invalid playlist URL: Could not extract playlist ID', null, 400);
    }

    const options = {
      headless: true,
      debug: debug === 'true',
      timeout: 30000,
      fast: fast === 'true',
    };

    const playlistData = await scrapePlaylist(url, options);
    const mappedData = mapSpotifyPlaylist(playlistData);

    return sendSuccess(reply, mappedData, 'Playlist scraped successfully', 'spotify');
  } catch (error) {
    console.error('[Spotify API] Error scraping playlist:', error);
    return sendError(reply, 'Failed to scrape playlist', error.message, 500);
  }
};

const playlistMapController = async (
  req: FastifyRequest<{ Querystring: PlaylistQuery }>,
  reply: FastifyReply,
) => {
  try {
    const { url, fast, debug, limit } = req.query;

    if (!url) {
      return sendError(reply, 'Missing required parameter: url', null, 400);
    }

    if (!url.includes('spotify.com/playlist/')) {
      return sendError(
        reply,
        'Invalid URL: Please provide a valid Spotify playlist URL',
        null,
        400,
      );
    }

    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
      return sendError(reply, 'Invalid playlist URL: Could not extract playlist ID', null, 400);
    }

    const jobOptions = {
      fast: fast === 'true',
      debug: debug === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    const { jobId, isExisting } = await addPlaylistMappingJob(url, jobOptions);

    const data = {
      jobId,
      status: isExisting ? 'existing' : 'queued',
      checkStatusUrl: `/spotify/playlist/map/status/${jobId}`,
      estimatedTime: isExisting ? 'Available now or processing' : '2-5 minutes',
      isExistingJob: isExisting,
    };

    return sendSuccess(
      reply,
      data,
      isExisting
        ? 'This playlist is already being processed'
        : 'Playlist mapping job has been queued',
      'spotify',
    );
  } catch (error) {
    console.error('[Spotify API] Error queueing playlist mapping job:', error);
    return sendError(reply, 'Failed to queue playlist mapping job', error.message, 500);
  }
};

const playlistMapStatusController = async (
  req: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return sendError(reply, 'Missing job ID', null, 400);
    }

    const jobStatus = await getJobStatus(jobId);

    return sendSuccess(reply, { jobId, ...jobStatus }, 'Job status fetched', 'spotify');
  } catch (error) {
    console.error('[Spotify API] Error checking job status:', error);
    return sendError(reply, 'Failed to check job status', error.message, 500);
  }
};

const queueStatsController = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const stats = await getQueueStats();

    return sendSuccess(
      reply,
      {
        queue: {
          name: 'playlist-mapping',
          ...stats,
        },
      },
      'Queue statistics fetched',
      'spotify',
    );
  } catch (error) {
    console.error('[Spotify API] Error getting queue stats:', error);
    return sendError(reply, 'Failed to get queue statistics', error.message, 500);
  }
};

export {
  playlistController,
  playlistMapController,
  playlistMapStatusController,
  queueStatsController,
};
