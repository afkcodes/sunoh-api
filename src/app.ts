import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { gaanaRoutes } from './gaana/route';
import IOValKeyCache from './helpers/cache';
import { play } from './play';
import { proxyImage } from './proxyImage';
import { saavnRoutes } from './saavn/route';

export const cache = new IOValKeyCache(process.env.VALKEY_URL || 'redis://localhost:6379');

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  fastify.get('/proxy', proxyImage);
  fastify.get('/play', play);
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  fastify.register(gaanaRoutes, { prefix: '/gaana' });
  // fastify.register(youtubeRoutes, { prefix: '/ytm' });

  done();
};

export default entry;
