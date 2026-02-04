import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseLyrics } from '../helpers/lyricsParser';
import { sendError, sendSuccess } from '../utils/response';
import AppleMusicLyricsLRC from './lyrics';

interface LyricsParams {
  songName: string;
}

interface LyricsQuery {
  storefront?: string;
  lrcType?: string;
  language?: string;
  format?: 'lrc' | 'ttml';
}

export const lyricsRoutes = async (fastify: FastifyInstance) => {
  const appleLyrics = new AppleMusicLyricsLRC({
    enableDebug: false,
    languageCode: 'en-IN',
    countryCode: 'in',
  });

  // Get lyrics by song name - searches and fetches in one call
  fastify.get<{
    Params: LyricsParams;
    Querystring: LyricsQuery;
  }>(
    '/:songName',
    async (
      request: FastifyRequest<{
        Params: LyricsParams;
        Querystring: LyricsQuery;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { songName } = request.params;
        const {
          storefront = 'in',
          lrcType = 'lyrics',
          language = 'En-IN',
          format = 'lrc',
        } = request.query;

        // Get tokens from environment variables
        const token = process.env.LYRICS_TOKEN;
        const mediaUserToken = process.env.MEDIA_USER_TOKEN;

        if (!songName) {
          return sendError(reply, 'Song name is required', null, 400);
        }

        if (!token || !mediaUserToken) {
          return sendError(reply, 'Apple Music lyrics service is not configured', null, 500);
        }

        // Step 1: Search for the song
        const searchResults = await appleLyrics.searchAppleMusic(songName, { limit: 1 });

        if (!searchResults || searchResults.length === 0) {
          return sendError(reply, `No songs found for: ${songName}`, null, 404);
        }

        const song = searchResults[0];

        // Step 2: Fetch lyrics using the track ID
        const options = {
          language: 'En-IN' as string,
          format: format as 'lrc' | 'ttml',
        };

        const lyrics = await appleLyrics.fetchLyricsWithAuth(
          song.trackId.toString(),
          storefront,
          lrcType,
          token,
          mediaUserToken,
          options,
        );

        const responseData = {
          songInfo: {
            trackId: song.trackId,
            trackName: song.trackName,
            artistName: song.artistName,
            albumName: song.albumName,
            artworkUrl: song.artworkUrl,
            isLyricsAvailable: song.isLyricsAvailable,
          },
          lyrics,
          parsed: format === 'lrc' ? parseLyrics(lyrics) : null,
          format,
        };

        return sendSuccess(reply, responseData, 'Lyrics fetched successfully', 'apple-music');
      } catch (error: any) {
        return sendError(reply, error.message || 'Failed to fetch lyrics', error);
      }
    },
  );

  // Health check for lyrics service
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return sendSuccess(
      reply,
      {
        usage: 'GET /lyrics/:songName?storefront=us&format=lrc',
        example: '/lyrics/Shape%20of%20You',
        note: 'Apple Music tokens are configured via environment variables',
      },
      'Lyrics service is running',
      'apple-music',
    );
  });
};
