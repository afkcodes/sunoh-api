import { FastifyInstance } from 'fastify';
import {
  albumController,
  albumListController,
  artistController,
  collectionController,
  homeController,
  playlistController,
  searchController,
  songController,
  songRecommendController,
  songStreamController,
} from './controller';

export const gaanaRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/home', homeController);
  fastify.get('/search', searchController);
  fastify.get('/album/:albumId', albumController);
  fastify.get('/playlist/:playlistId', playlistController);
  fastify.get('/song/:songId', songController);
  fastify.get('/song/:songId/recommend', songRecommendController);
  fastify.get('/song/:songId/stream', songStreamController);
  fastify.get('/collection/:seokey', collectionController);
  fastify.get('/album-list', albumListController);
  fastify.get('/artist/:artistId', artistController);
};
