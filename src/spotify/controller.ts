import { FastifyReply, FastifyRequest } from 'fastify';
import { mapTracks } from '../spotify_import/maptoSaavn';
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

    // Parse options
    const options = {
      headless: true, // Always headless for API
      debug: debug === 'true',
      timeout: 30000,
      fast: fast === 'true',
    };

    const mappingOptions = {
      debug: debug === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    // Log the request for debugging
    if (options.debug) {
      console.log(`[Spotify API] Scraping and mapping playlist: ${url}`);
      console.log(`[Spotify API] Options:`, { ...options, ...mappingOptions });
    }

    // First scrape the playlist
    const playlistData = await scrapePlaylist(url, options);

    if (options.debug) {
      console.log(
        `[Spotify API] Scraped ${playlistData.tracks.length} tracks, starting mapping...`,
      );
    }

    // Then map the tracks to Saavn
    const mappedTracks = await mapTracks(playlistData.tracks, mappingOptions);

    // Calculate statistics
    const matched = mappedTracks.filter((m) => m.saavnBest !== null).length;
    const processed = mappedTracks.length;
    const noMatch = processed - matched;

    // Transform to the required format
    const transformedItems = mappedTracks.map((item, index) => {
      const hasMatch = item.saavnBest !== null;

      return {
        spotify: {
          name: item.spotify.name,
          artists: item.spotify.artists,
          album: item.spotify.album,
          durationMs: item.spotify.durationMs,
          duration: item.spotify.duration,
          id: item.spotify.id,
          url: item.spotify.url,
          scrollPosition: index,
        },
        query: item.query,
        attempts: 1, // You may want to track this in mapTracks function
        candidatesConsidered: item.candidatesConsidered,
        match: hasMatch
          ? item.saavnBest // Raw, unmodified Saavn API response
          : null,
        score: item.score,
        status: hasMatch ? 'matched' : 'noMatch',
      };
    });

    // Return data in the required format
    return reply.send({
      source: {
        playlistId: playlistData.playlistId,
        name: playlistData.playlistName || 'Unknown Playlist',
        trackCount: playlistData.trackCount,
      },
      generatedAt: new Date().toISOString(),
      params: {
        limit: mappingOptions.limit || processed,
        minScore: 0.55, // You may want to make this configurable
      },
      summary: {
        processed,
        matched,
        lowConfidence: 0, // You may want to implement this based on score threshold
        noMatch,
      },
      items: transformedItems,
    });
  } catch (error) {
    console.error('[Spotify API] Error scraping/mapping playlist:', error);

    return reply.status(500).send({
      error: 'Failed to scrape and map playlist',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

export { playlistController, playlistMapController };
