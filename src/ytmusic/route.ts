// YouTube Music routes — mounted at `/ytmusic` from src/app.ts.
//
// Phase 1 MVP: text search + per-track stream URL resolution. The
// search-merge in the Flutter global Search picks up the /search
// endpoint; the stream resolver tier hits /song/:videoId/stream on
// play.
//
// Future phases (NOT wired yet — covered in the Phase 2/3 plan):
//   - /album/:browseId, /artist/:browseId, /playlist/:browseId  (browse)
//   - /home, /explore                                            (curation)
//   - /library, /history, /like                                 (account)

import type { FastifyInstance } from 'fastify';

import {
  ytmusicAudioProxyController,
  ytmusicSearchController,
  ytmusicStreamController,
} from './controller';

export async function ytmusicRoutes(fastify: FastifyInstance) {
  fastify.get('/search', ytmusicSearchController);
  fastify.get('/song/:videoId/stream', ytmusicStreamController);
  // Audio byte proxy — Flutter audio engine fetches this URL, we
  // fetch googlevideo from the VPS IP, pipe the bytes through. Range
  // header forwarded so seek + pre-buffer work the same as direct.
  fastify.get('/audio/:videoId', ytmusicAudioProxyController);
}
