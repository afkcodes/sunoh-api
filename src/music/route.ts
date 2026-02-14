import { FastifyInstance } from 'fastify';
import {
  albumController as gaanaAlbumController,
  albumListController as gaanaAlbumListController,
  artistController as gaanaArtistController,
  collectionController as gaanaCollectionController,
  homeController as gaanaHomeController,
  occasionController as gaanaOccasionController,
  occasionDetailController as gaanaOccasionDetailController,
  occasionItemsController as gaanaOccasionItemsController,
  playlistController as gaanaPlaylistController,
  radioDetailController as gaanaRadioDetailController,
  radioStationsController as gaanaRadioStationsController,
  searchController as gaanaSearchController,
  songController as gaanaSongController,
  songStreamController as gaanaSongStreamController,
} from '../gaana/controller';
import {
  albumController as saavnAlbumController,
  albumRecommendationController as saavnAlbumRecommendationController,
  artistController as saavnArtistController,
  featuredStationsController as saavnFeaturedStationsController,
  homeController as saavnHomeController,
  playlistController as saavnPlaylistController,
  searchController as saavnSearchController,
  songController as saavnSongController,
  stationSongsController as saavnStationSongsController,
} from '../saavn/controller';
import { playlistController as spotifyPlaylistController } from '../spotify/controller';
import {
  unifiedArtistRadioController,
  unifiedHomeController,
  unifiedRadioController,
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
  fastify.get('/album/:albumId/recommend', (req, reply) =>
    saavnAlbumRecommendationController(req as any, reply),
  );

  // Song
  fastify.get('/song/:songId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaSongController(req as any, reply);
    return saavnSongController(req as any, reply);
  });
  fastify.get('/song/:songId/recommend', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') {
      return reply
        .status(400)
        .send({ error: 'Song recommendations are only supported for Saavn provider currently' });
    }
    return unifiedSongRecommendController(req as any, reply);
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
      return spotifyPlaylistController(req as any, reply);
    }
    if (provider === 'gaana') {
      return gaanaPlaylistController(req as any, reply);
    }
    return saavnPlaylistController(req as any, reply);
  });

  // Collection (Gaana specific for now)
  fastify.get('/collection/:seokey', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaCollectionController(req as any, reply);
    reply
      .status(400)
      .send({ error: 'Collections are only supported for Gaana provider currently' });
  });

  // Radio
  fastify.get('/radio', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaRadioStationsController(req as any, reply);
    if (provider === 'saavn') return saavnFeaturedStationsController(req as any, reply);
    return unifiedRadioController(req as any, reply);
  });

  fastify.get('/artist/:artistId/radio', (req, reply) => {
    return unifiedArtistRadioController(req as any, reply);
  });

  fastify.get('/artist/radio', (req, reply) => {
    return unifiedArtistRadioController(req as any, reply);
  });

  fastify.get('/radio/:radioId', (req, reply) => {
    const { provider } = req.query as any;
    const { radioId } = req.params as any;
    if (provider === 'gaana') return gaanaRadioDetailController(req as any, reply);
    if (provider === 'saavn') {
      // Repackage params for Saavn controller which expects stationId in query
      const saavnReq = {
        ...(req as any),
        query: { ...(req.query as any), stationId: radioId },
      };
      return saavnStationSongsController(saavnReq as any, reply);
    }
    reply.status(400).send({ error: 'Please specify a provider (gaana or saavn)' });
  });

  // Album List
  fastify.get('/album-list', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaAlbumListController(req as any, reply);
    reply
      .status(400)
      .send({ error: 'Album lists are only supported for Gaana provider currently' });
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
    reply
      .status(400)
      .send({ error: 'Occasion details are only supported for Gaana provider currently' });
  });

  fastify.get('/occasions/:id/items', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaOccasionItemsController(req as any, reply);
    reply
      .status(400)
      .send({ error: 'Occasion items are only supported for Gaana provider currently' });
  });

  // Artist
  fastify.get('/artist/:artistId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaArtistController(req as any, reply);
    return saavnArtistController(req as any, reply);
  });

  // Languages
  fastify.get('/languages', getLanguages);
};
