import { FastifyInstance } from 'fastify';
import {
  albumController,
  homeController,
  playlistController,
  searchController,
  songController,
} from './controller';

export const gaanaRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/home', homeController);
  fastify.get('/search', searchController);
  fastify.get('/album/:albumId', albumController);
  fastify.get('/playlist/:playlistId', playlistController);
  fastify.get('/song/:songId', songController);
};
