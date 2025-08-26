import { FastifyReply, FastifyRequest } from 'fastify';
import { addPlaylistMappingJob, getJobStatus, getQueueStats } from '../queue/playlistQueue';
import { extractPlaylistId, scrapePlaylist } from '../spotify_import/spotify_playlist';

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

    // Validate URL parameter
    if (!url) {
      return reply.status(400).send({
        error: 'Missing required parameter: url',
        message: 'Please provide a Spotify playlist URL in the query parameter',
        example: '/spotify/playlist?url=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      });
    }

    // Validate that it's a Spotify playlist URL
    if (!url.includes('spotify.com/playlist/')) {
      return reply.status(400).send({
        error: 'Invalid URL',
        message: 'Please provide a valid Spotify playlist URL',
        provided: url,
      });
    }

    // Extract playlist ID to validate URL format
    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
      return reply.status(400).send({
        error: 'Invalid playlist URL',
        message: 'Could not extract playlist ID from the provided URL',
        provided: url,
      });
    }

    // Parse options
    const options = {
      headless: true, // Always headless for API
      debug: debug === 'true',
      timeout: 30000,
      fast: fast === 'true',
    };

    // Log the request for debugging
    if (options.debug) {
      console.log(`[Spotify API] Scraping playlist: ${url}`);
      console.log(`[Spotify API] Options:`, options);
    }

    // Scrape the playlist
    const playlistData = await scrapePlaylist(url, options);

    // Return the scraped data
    return reply.send({
      success: true,
      data: playlistData,
      metadata: {
        scrapedAt: new Date().toISOString(),
        options: {
          fast: options.fast,
          debug: options.debug,
        },
      },
    });
  } catch (error) {
    console.error('[Spotify API] Error scraping playlist:', error);

    return reply.status(500).send({
      error: 'Failed to scrape playlist',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const playlistMapController = async (
  req: FastifyRequest<{ Querystring: PlaylistQuery }>,
  reply: FastifyReply,
) => {
  try {
    const { url, fast, debug, limit } = req.query;

    // Validate URL parameter
    if (!url) {
      return reply.status(400).send({
        error: 'Missing required parameter: url',
        message: 'Please provide a Spotify playlist URL in the query parameter',
        example:
          '/spotify/playlist/map?url=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      });
    }

    // Validate that it's a Spotify playlist URL
    if (!url.includes('spotify.com/playlist/')) {
      return reply.status(400).send({
        error: 'Invalid URL',
        message: 'Please provide a valid Spotify playlist URL',
        provided: url,
      });
    }

    // Extract playlist ID to validate URL format
    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
      return reply.status(400).send({
        error: 'Invalid playlist URL',
        message: 'Could not extract playlist ID from the provided URL',
        provided: url,
      });
    }

    // Prepare job options
    const jobOptions = {
      fast: fast === 'true',
      debug: debug === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    if (jobOptions.debug) {
      console.log(`[Spotify API] Queueing playlist mapping job: ${url}`);
    }

    // Add job to queue
    const jobId = await addPlaylistMappingJob(url, jobOptions);

    // Return job information immediately (non-blocking)
    return reply.send({
      success: true,
      jobId,
      status: 'queued',
      message: 'Playlist mapping job has been queued for processing',
      checkStatusUrl: `/spotify/playlist/map/status/${jobId}`,
      estimatedTime: '2-5 minutes depending on playlist size',
      queuedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Spotify API] Error queueing playlist mapping job:', error);

    return reply.status(500).send({
      error: 'Failed to queue playlist mapping job',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

// New controller to check job status
const playlistMapStatusController = async (
  req: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return reply.status(400).send({
        error: 'Missing job ID',
        message: 'Please provide a valid job ID',
      });
    }

    const jobStatus = await getJobStatus(jobId);

    return reply.send({
      jobId,
      ...jobStatus,
    });
  } catch (error) {
    console.error('[Spotify API] Error checking job status:', error);

    return reply.status(500).send({
      error: 'Failed to check job status',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

// New controller to get queue statistics
const queueStatsController = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const stats = await getQueueStats();

    return reply.send({
      success: true,
      queue: {
        name: 'playlist-mapping',
        ...stats,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Spotify API] Error getting queue stats:', error);

    return reply.status(500).send({
      error: 'Failed to get queue statistics',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

export {
  playlistController,
  playlistMapController,
  playlistMapStatusController,
  queueStatsController,
};
