import { FastifyInstance } from 'fastify';
import {
  albumController,
  albumRecommendationController,
  artistController,
  artistStationController,
  entityStationController,
  featuredStationsController,
  homeController,
  mixController,
  modulesController,
  playlistController,
  recommendedSongsController,
  searchController,
  songController,
  stationController,
  stationSongsController,
  topAlbumsOfYearController,
  topSearchController,
} from './controller';

const saavnRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', homeController);
  fastify.get('/modules', modulesController);
  fastify.get('/album/:albumId', albumController);
  fastify.get('/album/:albumId/recommend', albumRecommendationController);
  fastify.get('/album/top_albums/:year', topAlbumsOfYearController);
  fastify.get('/playlist/:playlistId', playlistController);
  fastify.get('/artist/:artistId', artistController);
  fastify.get('/song/:songId', songController);
  fastify.get('/mix/:mixId', mixController);
  fastify.get('/create_station', stationController);
  fastify.get('/create_artist_station', artistStationController);
  fastify.get('/create_entity_station', entityStationController);
  fastify.get('/featured_stations', featuredStationsController);
  fastify.get('/get_station_songs', stationSongsController);
  fastify.get('/top_search', topSearchController);
  fastify.get('/search', searchController);
  fastify.get('/recommended_songs/:songId', recommendedSongsController);
};

export { saavnRoutes };
