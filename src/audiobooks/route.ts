// Audiobooks routes — mounted at `/audiobooks` from src/app.ts.
//
// Mirrors the /podcasts + /radios shape: aggregated home + facet list
// + per-category drilldown + search + single-book-by-slug. Backed by
// cozyaudiobooks.com via the WP REST API + HTML scrape (controller.ts).

import type { FastifyInstance } from 'fastify';

import {
  audiobookDetailController,
  audiobooksByCategoryController,
  audiobooksCategoriesController,
  audiobooksHomeController,
  audiobooksSearchController,
} from './controller';

export async function audiobookRoutes(fastify: FastifyInstance) {
  // Multi-section home — primary entry point for the Audiobooks tab.
  fastify.get('/home', audiobooksHomeController);

  // Facet list + per-category drilldown + search.
  fastify.get('/categories', audiobooksCategoriesController);
  fastify.get('/by-category', audiobooksByCategoryController);
  fastify.get('/search', audiobooksSearchController);

  // Single book by slug. Registered LAST so the literal route segments
  // above aren't shadowed by the catch-all `:slug` parameter.
  fastify.get('/:slug', audiobookDetailController);
}
