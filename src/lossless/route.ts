import { FastifyInstance } from 'fastify';
import {
  availableController,
  downloadController,
  progressController,
  searchController,
  statusController,
} from './controller';
import { initEngines } from './registry';

/**
 * Lossless engine routes, mounted at /lossless.
 *
 * These download real audio, unlike /match which only answers whether a track
 * exists losslessly. Credentials come from the environment; without them the
 * endpoints report 503 rather than failing obscurely.
 */
const losslessRoutes = async (fastify: FastifyInstance) => {
  // Loads persisted tokens once, at registration rather than per request.
  await initEngines();

  fastify.get('/status', statusController);
  fastify.get('/search', searchController);
  fastify.get('/progress/:jobId', progressController);
  fastify.post('/available', availableController);
  fastify.post('/download', downloadController);
};

export { losslessRoutes };
export default losslessRoutes;
