import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { gaanaRoutes } from './gaana/route';
import IOValKeyCache from './helpers/cache';
import { play } from './play';
import { proxyImage } from './proxyImage';
import { saavnRoutes } from './saavn/route';
import { liveMusicRoutes } from './websocket/routes';

export const cache = new IOValKeyCache(process.env.VALKEY_URL || 'redis://localhost:6379');

// Temporarily disable cache operations for WebSocket testing
// cache.deleteAll();

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  fastify.get('/proxy', proxyImage);
  fastify.get('/play', play);
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  fastify.register(gaanaRoutes, { prefix: '/gaana' });
  fastify.register(liveMusicRoutes, { prefix: '/live' });
  // fastify.register(youtubeRoutes, { prefix: '/ytm' });

  done();
};

export default entry;
