import { FastifyInstance } from 'fastify';
import { albumController, homeController, modulesController } from './controller';

const saavnRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', homeController);
  fastify.get('/modules', modulesController);
  fastify.get('/album/:albumId', albumController);
};

export { saavnRoutes };
