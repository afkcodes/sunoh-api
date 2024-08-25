import { FastifyInstance } from 'fastify';
import { ytHomeController } from './controller';

const youtubeRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/home', ytHomeController);
};

export { youtubeRoutes };
