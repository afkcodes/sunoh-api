import * as dotenv from 'dotenv';

import cors from '@fastify/cors';
// Require the framework
import Fastify from 'fastify';
import entry from '../src/app';
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
const port = 3600;
app.listen({ port }).then(() => {
  console.log(`Server Started at http://localhost:${port}`);
  
  // Initialize WebSocket server after HTTP server is running
  initializeLiveMusicWebSocket(app.server);
  console.log(`🎵 WebSocket server ready at ws://localhost:${port}/ws/live-music`);
});
