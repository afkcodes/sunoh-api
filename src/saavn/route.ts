import { FastifyInstance } from 'fastify';
import { homeController, modulesController } from './controller';

const saavnRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', homeController);
  fastify.get('/modules', modulesController);
};

export { saavnRoutes };
