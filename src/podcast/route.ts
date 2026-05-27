// Podcast routes — mounted at `/podcasts` from src/app.ts.
//
// Path schema mirrors the music side: discovery + search at the
// collection root, show detail under `/:id`, episodes under
// `/:id/episodes`, and a single-episode lookup under `/episode/:guid`.

import type { FastifyInstance } from 'fastify';

import {
  podcastEpisodeController,
  podcastEpisodesController,
  podcastShowController,
  podcastsByCategoryController,
  podcastsCategoriesController,
  podcastsRecentController,
  podcastsSearchController,
  podcastsTrendingController,
} from './controller';

export async function podcastRoutes(fastify: FastifyInstance) {
  // Discovery
  fastify.get('/trending', podcastsTrendingController);
  fastify.get('/recent', podcastsRecentController);
  fastify.get('/categories', podcastsCategoriesController);
  fastify.get('/by-category/:slug', podcastsByCategoryController);

  // Search
  fastify.get('/search', podcastsSearchController);

  // Episode-by-guid (declared BEFORE `/:id` so the literal `/episode`
  // segment isn't captured by the parameterised show route).
  fastify.get('/episode/:guid', podcastEpisodeController);
  fastify.get('/episode', podcastEpisodeController); // ?id=… fallback

  // Show detail + episode list
  fastify.get('/:id/episodes', podcastEpisodesController);
  fastify.get('/:id', podcastShowController);
}
