import { FastifyInstance } from 'fastify';
import {
  playlistController,
  playlistMapController,
  playlistMapStatusController,
  queueStatsController,
} from './controller';

const spotifyRoutes = async (fastify: FastifyInstance) => {
  // Basic playlist scraping (still synchronous for quick results)
  fastify.get('/playlist', playlistController);

  // Queue-based playlist mapping (non-blocking)
  fastify.get('/playlist/map', playlistMapController);

  // Check status of a mapping job
  fastify.get('/playlist/map/status/:jobId', playlistMapStatusController);

  // Get queue statistics
  fastify.get('/queue/stats', queueStatsController);
};

export { spotifyRoutes };
