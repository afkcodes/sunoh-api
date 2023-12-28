import * as dotenv from 'dotenv';

import Fastify from 'fastify';
// Require the framework
dotenv.config();

// Instantiate Fastify with some config
const app = Fastify({
  logger: true,
});

// Register your application as a normal plugin.
app.register(import('../src/app'));

export default async (req, res) => {
  await app.ready();
  app.server.emit('request', req, res);
};
