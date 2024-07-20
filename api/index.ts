import * as dotenv from 'dotenv';

import Fastify from 'fastify';
import entry from '../dist/src/app';

// Require the framework
dotenv.config();

// Instantiate Fastify with some config
const app = Fastify({
  logger: true,
});

// Register your application as a normal plugin.
app.register(entry);

export default async (req, res) => {
  await app.ready();
  app.server.emit('request', req, res);
};
