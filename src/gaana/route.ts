import { FastifyInstance } from 'fastify';
import { radioController, radioDetailController, trackController } from './controller';

const gaanaRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/radio/:radioId', radioDetailController);
  fastify.get('/radios/popular', radioController);
  fastify.get('/track/:trackId', trackController);
};

export { gaanaRoutes };
