import * as dotenv from 'dotenv';

import cors from '@fastify/cors';
import Fastify from 'fastify';
import entry from '../src/app';

// Require the framework
dotenv.config();

// Instantiate Fastify with some config
const app = Fastify({
  logger: true,
});

app.register(cors, {
  origin: '*',
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
});

// Register your application as a normal plugin.
app.register(entry);

export default async (req, res) => {
  await app.ready();
  app.server.emit('request', req, res);
};
