import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { audiobookRoutes } from './audiobooks/route';
import { musicRoutes } from './music/route';
import { podcastRoutes } from './podcast/route';
import { spotifyRoutes } from './spotify/route';

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done: () => void) => {
  fastify.get('/', async () => ({
    status: 'success',
    message: 'Sunoh API is running',
    version: '1.0.0',
  }));

  // Unified Music Route
  fastify.register(musicRoutes, { prefix: '/music' });

  fastify.register(spotifyRoutes, { prefix: '/spotify' });

  // Podcasts — backed by PodcastIndex.org via HMAC-style auth (the
  // creds stay server-side in process.env). Mappers normalise to the
  // unified FeedItem schema with `type: 'podcast'` for shows and
  // `type: 'episode'` for episodes; episode `mediaUrls[0].link` is the
  // raw enclosure URL so the Flutter resolver plays it directly.
  fastify.register(podcastRoutes, { prefix: '/podcasts' });

  // Audiobooks — backed by cozyaudiobooks.com (WordPress REST + AJAX
  // search + per-post HTML scrape for cover/author/chapters). All hot
  // paths; home aggregator parallel-enriches ~50 books
  // cold then serves instant for 1 h. Chapter mediaUrls inline so the
  // stream resolver short-circuits to tier-1 on play.
  fastify.register(audiobookRoutes, { prefix: '/audiobooks' });

  done();
};

export default entry;
