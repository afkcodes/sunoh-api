// Radio routes — mounted at `/radios` from src/app.ts.
//
// Mirrors the /podcasts shape: aggregated home + listing + search +
// facets + single-station-by-slug. Backed by the sunoh-radio service
// (separate repo, runs on localhost:4000) which curates ~50 k working
// stations from onlineradiobox + a validation pipeline.

import type { FastifyInstance } from 'fastify';

import {
  radioStationController,
  radiosCountriesController,
  radiosGenresController,
  radiosHomeController,
  radiosLanguagesController,
  radiosSearchController,
  radiosStationsController,
  radiosStatsController,
} from './controller';

export async function radioRoutes(fastify: FastifyInstance) {
  // Country-aware multi-section feed — primary entry point for the
  // Flutter Radio tab.
  fastify.get('/home', radiosHomeController);

  // Listing + filters (used by category screens) + search.
  fastify.get('/stations', radiosStationsController);
  fastify.get('/search', radiosSearchController);

  // Facets — for the genre / country browsers.
  fastify.get('/countries', radiosCountriesController);
  fastify.get('/genres', radiosGenresController);
  fastify.get('/languages', radiosLanguagesController);
  fastify.get('/stats', radiosStatsController);

  // Single station by slug. Registered LAST so the literal facet routes
  // above aren't shadowed by the catch-all `:slug` parameter.
  fastify.get('/:slug', radioStationController);
}
