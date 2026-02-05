import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { lyricsRoutes } from './lyrics/route';
import { musicRoutes } from './music/route';
import { play } from './play';
import { proxyImage } from './proxyImage';
import { saavnRoutes } from './saavn/route';
import { spotifyRoutes } from './spotify/route';
import { liveMusicRoutes } from './websocket/routes';

export { cache } from './redis';

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done: () => void) => {
  fastify.get('/', async () => ({
    status: 'success',
    message: 'Sunoh API is running',
    version: '1.0.0',
  }));

  fastify.get('/proxy', proxyImage);
  fastify.get('/play', play);

  // Unified Music Route
  fastify.register(musicRoutes, { prefix: '/music' });

  // Legacy/Specific Provider Routes (optional to keep, but keeping for now)
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  fastify.register(spotifyRoutes, { prefix: '/spotify' });

  // Other Services
  fastify.register(lyricsRoutes, { prefix: '/lyrics' });
  fastify.register(liveMusicRoutes, { prefix: '/live' });

  done();
};

export default entry;
