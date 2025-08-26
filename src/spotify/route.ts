import { FastifyInstance } from 'fastify';
import { playlistController, playlistMapController } from './controller';

const spotifyRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/playlist', playlistController);
  fastify.get('/playlist/map', playlistMapController);
};

export { spotifyRoutes };
