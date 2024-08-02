import { FastifyInstance } from 'fastify';
import {
  albumController,
  albumRecommendationController,
  homeController,
  mixController,
  modulesController,
  playlistController,
  stationController,
  stationSongsController,
  topAlbumsOfYearController,
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
};

export { saavnRoutes };
mixController;
