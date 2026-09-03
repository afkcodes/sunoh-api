import { FastifyInstance } from 'fastify';
import {
  clearCacheController,
  losslessMatchController,
  normalizeController,
  similarAlbumsController,
  similarArtistsController,
  statusController,
} from './controller';

/**
 * Lossless matching routes.
 *
 * Mounted at /match. These sit alongside the existing Spotify -> Saavn matcher
 * in src/spotify/match.ts, which is untouched; this one answers the opposite
 * question (given a Saavn or Gaana track, is it available lossless).
 */
const matcherRoutes = async (fastify: FastifyInstance) => {
  fastify.post('/lossless', losslessMatchController);
  fastify.post('/normalize', normalizeController);
  fastify.get('/status', statusController);

  // Discovery from the lossless catalogue. Available without a subscription,
  // unlike its stream endpoint, which returns a 30-second preview.
  fastify.get('/similar/artist/:id', similarArtistsController);
  fastify.get('/similar/album/:id', similarAlbumsController);
  fastify.delete('/cache/:source/:id', clearCacheController);
};

export { matcherRoutes };
export default matcherRoutes;
