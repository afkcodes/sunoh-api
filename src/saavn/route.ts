import { FastifyInstance } from 'fastify';
import {
  albumController,
  albumRecommendationController,
  artistController,
  artistStationController,
  channelController,
  entityStationController,
  homeController,
  mixController,
  modulesController,
  playlistController,
  recommendedSongsController,
  searchController,
  songController,
  stationController,
  stationSongsController,
  topAlbumsOfYearController,
  topSearchController,
} from './controller';

const saavnRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', homeController);
  fastify.get('/modules', modulesController);
  fastify.get('/album/:albumId', albumController);
  fastify.get('/album/:albumId/recommend', albumRecommendationController);
  fastify.get('/album/top_albums/:year', topAlbumsOfYearController);
  fastify.get('/playlist/:playlistId', playlistController);
  fastify.get('/artist/:artistId', artistController);
  fastify.get('/song/:songId', songController);
  fastify.get('/mix/:mixId', mixController);
  fastify.get('/channel/:channelId', channelController);

  fastify.get('/top_search', topSearchController);
  fastify.get('/search', searchController);
  fastify.get('/recommended_songs/:songId', recommendedSongsController);
  fastify.get('/station/create', entityStationController);
  fastify.get('/station/create/artist', artistStationController);
  fastify.get('/station/create/featured', stationController);
  fastify.get('/station/:stationId', stationSongsController);
};

export { saavnRoutes };
