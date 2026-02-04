import { FastifyInstance } from 'fastify';
import {
  albumController as gaanaAlbumController,
  homeController as gaanaHomeController,
  playlistController as gaanaPlaylistController,
  searchController as gaanaSearchController,
  songController as gaanaSongController,
} from '../gaana/controller';
import {
  albumController as saavnAlbumController,
  albumRecommendationController as saavnAlbumRecommendationController,
  artistController as saavnArtistController,
  homeController as saavnHomeController,
  playlistController as saavnPlaylistController,
  searchController as saavnSearchController,
  songController as saavnSongController,
} from '../saavn/controller';
import { playlistController as spotifyPlaylistController } from '../spotify/controller';
import { getLanguages } from './languages';

export const musicRoutes = async (fastify: FastifyInstance) => {
  // Home
  fastify.get('/home', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaHomeController(req as any, reply);
    return saavnHomeController(req as any, reply);
  });

  // Search
  fastify.get('/search', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaSearchController(req as any, reply);
    return saavnSearchController(req as any, reply);
  });

  // Album
  fastify.get('/album/:albumId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaAlbumController(req as any, reply);
    return saavnAlbumController(req as any, reply);
  });
  fastify.get('/album/:albumId/recommend', (req, reply) =>
    saavnAlbumRecommendationController(req as any, reply),
  );

  // Song
  fastify.get('/song/:songId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'gaana') return gaanaSongController(req as any, reply);
    return saavnSongController(req as any, reply);
  });

  // Playlist
  fastify.get('/playlist/:playlistId', (req, reply) => {
    const { provider } = req.query as any;
    if (provider === 'spotify') {
      return spotifyPlaylistController(req as any, reply);
    }
    if (provider === 'gaana') {
      return gaanaPlaylistController(req as any, reply);
    }
    return saavnPlaylistController(req as any, reply);
  });

  // Artist
  fastify.get('/artist/:artistId', (req, reply) => saavnArtistController(req as any, reply));

  // Languages
  fastify.get('/languages', getLanguages);
};
