import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseLyrics } from '../helpers/lyricsParser';
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
      console.log('CALLED', request.params);
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

        console.log(token, mediaUserToken);

        if (!songName) {
          return reply.status(400).send({
            success: false,
            message: 'Song name is required',
          });
        }

        if (!token) {
          return reply.status(500).send({
            success: false,
            message: 'Apple Music token not configured',
          });
        }

        if (!mediaUserToken) {
          return reply.status(500).send({
            success: false,
            message: 'Media user token not configured',
          });
        }

        // Step 1: Search for the song
        const searchResults = await appleLyrics.searchAppleMusic(songName, { limit: 1 });

        if (!searchResults || searchResults.length === 0) {
          return reply.status(404).send({
            success: false,
            message: `No songs found for: ${songName}`,
          });
        }

        const song = searchResults[0];

        // Step 2: Fetch lyrics using the track ID
        const options = {
          language: 'En-IN',
          format,
        };

        const lyrics = await appleLyrics.fetchLyricsWithAuth(
          song.trackId.toString(),
          storefront,
          lrcType,
          token,
          mediaUserToken,
          options,
        );

        return reply.send({
          success: true,
          data: {
            songInfo: {
              trackId: song.trackId,
              trackName: song.trackName,
              artistName: song.artistName,
              albumName: song.albumName,
              artworkUrl: song.artworkUrl,
              isLyricsAvailable: song.isLyricsAvailable,
            },
            lyrics,
            parsed: parseLyrics(lyrics),
            format,
          },
        });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          message: error.message || 'Failed to fetch lyrics',
        });
      }
    },
  );

  // Health check for lyrics service
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      message: 'Apple Music Lyrics API is running',
      usage: 'GET /lyrics/:songName?storefront=us&format=lrc',
      example: '/lyrics/Shape%20of%20You',
      note: 'Apple Music tokens are configured via environment variables',
    });
  });
};
