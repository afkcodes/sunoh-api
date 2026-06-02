// Radio routes — mounted at `/radios` from src/app.ts.
//
// Mirrors the /podcasts shape: aggregated home + listing + search +
// facets + single-station-by-slug. Backed by the sunoh-radio service
// (separate repo, runs on localhost:4000) which curates ~50 k working
// stations from onlineradiobox + a validation pipeline.

import type { FastifyInstance } from 'fastify';

import {
  radioNowPlayingController,
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

  // Listener-driven now-playing (Shazam-backed). Polled by the Flutter
  // client every ~5 s while a station is playing — the polling itself
  // is the "I'm listening" signal that keeps the background worker
  // fingerprinting the station. Registered BEFORE the catch-all
  // `:slug` so the literal segment `/now-playing` isn't shadowed.
  fastify.get('/:slug/now-playing', radioNowPlayingController);

  // Single station by slug. Registered LAST so the literal facet routes
  // above aren't shadowed by the catch-all `:slug` parameter.
  fastify.get('/:slug', radioStationController);
}
