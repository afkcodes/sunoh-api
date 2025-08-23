import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { gaanaRoutes } from './gaana/route';
import { lyricsRoutes } from './lyrics/route';
import { play } from './play';
import { proxyImage } from './proxyImage';
import { saavnRoutes } from './saavn/route';
import { liveMusicRoutes } from './websocket/routes';

// Temporarily disable Redis/Valkey cache for development
// export const cache = new IOValKeyCache(process.env.VALKEY_URL || 'redis://localhost:6379');

// Create a no-op cache for development without Redis
export const cache = {
  set: async (key: string, value: any, ttl?: number) => {},
  get: async <T = any>(key: string): Promise<T | null> => null,
  delete: async (key: string) => 0,
  deleteMany: async (keys: string[]) => 0,
  deleteAll: async () => 0,
  exists: async (key: string) => false,
  ttl: async (key: string) => -1,
  setMany: async (entries: Record<string, any>, ttl?: number) => {},
  getMany: async <T = any>(keys: string[]): Promise<(T | null)[]> => keys.map(() => null),
  increment: async (key: string, increment: number = 1) => 0,
  getClient: () => null,
};

// Temporarily disable cache operations for WebSocket testing
// cache.deleteAll();

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  fastify.get('/proxy', proxyImage);
  fastify.get('/play', play);
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  fastify.register(gaanaRoutes, { prefix: '/gaana' });
  fastify.register(lyricsRoutes, { prefix: '/lyrics' });
  fastify.register(liveMusicRoutes, { prefix: '/live' });
  // fastify.register(youtubeRoutes, { prefix: '/ytm' });

  done();
};

export default entry;
