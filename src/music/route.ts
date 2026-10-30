import { FastifyInstance } from 'fastify';
import {
  albumController as gaanaAlbumController,
  homeController as gaanaHomeController,
  occasionController as gaanaOccasionController,
  occasionDetailController as gaanaOccasionDetailController,
  playlistController as gaanaPlaylistController,
  searchController as gaanaSearchController,
  songController as gaanaSongController,
  songStreamController as gaanaSongStreamController,
} from '../gaana/controller';
import {
  albumController as saavnAlbumController,
  channelController as saavnChannelController,
  homeController as saavnHomeController,
  playlistController as saavnPlaylistController,
  searchController as saavnSearchController,
  songController as saavnSongController,
} from '../saavn/controller';
import { importPlaylistController as spotifyImportController } from '../spotify/controller';
import {
  unifiedArtistController,
  unifiedHomeController,
  unifiedRadioPlayController,
  unifiedRadioSessionController,
  unifiedSearchController,
  unifiedSongRecommendController,
} from './controller';
import { getLanguages } from './languages';

export const musicRoutes = async (fastify: FastifyInstance) => {
  // Home
  fastify.get('/home', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaHomeController(req as any, reply);
    if (provider === 'saavn') return saavnHomeController(req as any, reply);
    return unifiedHomeController(req as any, reply);
  });

  // Search
  fastify.get('/search', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaSearchController(req as any, reply);
    if (provider === 'saavn') return saavnSearchController(req as any, reply);
    return unifiedSearchController(req as any, reply);
  });

  // Album
  fastify.get('/album/:albumId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaAlbumController(req as any, reply);
    return saavnAlbumController(req as any, reply);
  });

  // Song
  fastify.get('/song/:songId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaSongController(req as any, reply);
    return saavnSongController(req as any, reply);
  });
  fastify.get('/recommend', (req, reply) => {
    return unifiedSongRecommendController(req as any, reply);
  });
  fastify.get('/song/:songId/stream', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaSongStreamController(req as any, reply);
    reply
      .status(400)
      .send({ error: 'Song streams are only supported for Gaana provider currently' });
  });

  // Playlist
  fastify.get('/playlist/:playlistId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'spotify') {
      // Spotify playlist import: the unified controller now expects ?url=,
      // but the music dispatch passes :playlistId via path. Adapt by
      // synthesising the URL on the way through.
      const { playlistId } = req.params as any;
      (req.query as any).url =
        (req.query as any).url || `https://open.spotify.com/playlist/${playlistId}`;
      return spotifyImportController(req as any, reply);
    }
    if (provider === 'gaana') {
      return gaanaPlaylistController(req as any, reply);
    }
    return saavnPlaylistController(req as any, reply);
  });

  // Occasions (Gaana specific)
  fastify.get('/occasions', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaOccasionController(req as any, reply);
    reply.status(400).send({ error: 'Occasions are only supported for Gaana provider currently' });
  });

  fastify.get('/occasions/:slug', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaOccasionDetailController(req as any, reply);
    if (provider === 'saavn') {
      const { slug } = req.params as any;
      (req.params as any).channelId = slug;
      return saavnChannelController(req as any, reply);
    }
    reply.status(400).send({
      error: 'Occasion details are only supported for Gaana and Saavn provider currently',
    });
  });

  // Artist
  fastify.get('/artist/:artistId', unifiedArtistController);

  // Radio
  fastify.get('/radio/session', unifiedRadioSessionController);
  fastify.get('/radio/:sessionId', unifiedRadioPlayController);

  // Languages
  fastify.get('/languages', getLanguages);
};
