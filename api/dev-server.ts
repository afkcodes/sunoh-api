import * as dotenv from 'dotenv';

import cors from '@fastify/cors';
// Require the framework
import Fastify from 'fastify';
import entry from '../src/app';
import { startNowPlayingWorker } from '../src/radios/now-playing-worker';
import { initializeLiveMusicWebSocket } from '../src/websocket/routes';

dotenv.config();

// Instantiate Fastify with some config
const app = Fastify({
  logger: false,
});

app.register(cors, {
  origin: '*',
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
});

// Register your application as a normal plugin.
app.register(entry, {
  prefix: '/',
});

// export default async (req, res) => {
//   await app.ready();
//   app.server.emit("request", req, res);
// };

// Run the server!
const port = Number(process.env.PORT) || 3600;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Server Started at http://localhost:${port}`);

  // Initialize WebSocket server after HTTP server is running
  initializeLiveMusicWebSocket(app.server);
  console.log(`🎵 WebSocket server ready at ws://localhost:${port}/ws/live-music`);

  // Listener-driven radio now-playing worker. Reads "hot" stations from
  // Redis (populated by Flutter polling /radios/:slug/now-playing) and
  // calls the Shazam sidecar on a per-slug back-off schedule. No-ops
  // when SHAZAM_BASE_URL is unset (local dev outside docker).
  startNowPlayingWorker();
});
