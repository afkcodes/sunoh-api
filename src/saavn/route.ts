import { FastifyInstance } from 'fastify';
import {
  albumController,
  albumRecommendationController,
  autoCompleteController,
  homeController,
  mixController,
  modulesController,
  playlistController,
  searchController,
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
  fastify.get('/mix/:mixId', mixController);
  fastify.get('/create_station', stationController);
  fastify.get('/get_station_songs', stationSongsController);
  fastify.get('/top_search', topSearchController);
  fastify.get('/auto_complete', autoCompleteController);
  fastify.post('/search', searchController);
};

export { saavnRoutes };
