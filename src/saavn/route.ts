import { FastifyInstance } from 'fastify';
import {
  albumController,
  albumRecommendationController,
  homeController,
  modulesController,
  topAlbumsOfYearController,
} from './controller';

const saavnRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', homeController);
  fastify.get('/modules', modulesController);
  fastify.get('/album/:albumId', albumController);
  fastify.get('/album/:albumId/recommend', albumRecommendationController);
  fastify.get('/album/top_albums/:year', topAlbumsOfYearController);
};

export { saavnRoutes };
