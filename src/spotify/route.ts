import type { FastifyInstance } from 'fastify';

import { importPlaylistController } from './controller';

// Single endpoint — playlist URL in, mapped result out. The previous
// scrape vs queued-job split is gone (see controller.ts header for the
// rationale).
const spotifyRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/import', importPlaylistController);
};

export { spotifyRoutes };
