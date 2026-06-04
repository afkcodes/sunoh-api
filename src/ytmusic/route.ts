// YouTube Music routes — mounted at `/ytmusic` from src/app.ts.
//
// Search ONLY lives server-side: anonymous /search from the VPS works
// fine, plus we get server-side caching across users. The Flutter
// global Search picks it up via `fetchYouTubeMusicSearch(query)`.
//
// **Stream URL resolution does NOT live here.** /player from a
// datacenter IP triggers YouTube's "Sign in to confirm you're not a
// bot" check (LOGIN_REQUIRED status). The Flutter app hits
// music.youtube.com/youtubei/v1/player directly from the device
// (residential IP), gets a stream URL bound to its own IP, and plays
// it without proxying. See lib/api/ytmusic_player.dart and the
// `youtube_music` tier in lib/api/stream_resolver.dart on the client
// side. The previous /song/:videoId/stream + /audio/:videoId proxy
// endpoints were removed in v1.8.5 after the bot-check made them
// fundamentally unworkable.
//
// Future phases (NOT wired yet — covered in the Phase 2/3 plan):
//   - /album/:browseId, /artist/:browseId, /playlist/:browseId  (browse)
//   - /home, /explore                                            (curation)
//   - /library, /history, /like                                 (account)

import type { FastifyInstance } from 'fastify';

import { ytmusicSearchController } from './controller';

export async function ytmusicRoutes(fastify: FastifyInstance) {
  fastify.get('/search', ytmusicSearchController);
}
