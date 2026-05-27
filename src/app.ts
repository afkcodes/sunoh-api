import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { gaanaRoutes } from './gaana/route';
import { lyricsRoutes } from './lyrics/route';
import { musicRoutes } from './music/route';
import { play } from './play';
import { podcastRoutes } from './podcast/route';
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
  fastify.register(gaanaRoutes, { prefix: '/gaana' });

  // Other Services
  fastify.register(lyricsRoutes, { prefix: '/lyrics' });
  fastify.register(liveMusicRoutes, { prefix: '/live' });
  // Podcasts — backed by PodcastIndex.org via HMAC-style auth (the
  // creds stay server-side in process.env). Mappers normalise to the
  // unified FeedItem schema with `type: 'podcast'` for shows and
  // `type: 'episode'` for episodes; episode `mediaUrls[0].link` is the
  // raw enclosure URL so the Flutter resolver plays it directly.
  fastify.register(podcastRoutes, { prefix: '/podcasts' });

  done();
};

export default entry;
