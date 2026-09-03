import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { audiobookRoutes } from './audiobooks/route';
import { gaanaRoutes } from './gaana/route';
import { lyricsRoutes } from './lyrics/route';
import { losslessRoutes } from './lossless/route';
import { matcherRoutes } from './matcher/route';
import { musicRoutes } from './music/route';
import { play } from './play';
import { podcastRoutes } from './podcast/route';
import { proxyImage } from './proxyImage';
import { radioRoutes } from './radios/route';
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

  // Lossless matching — given a Saavn or Gaana Song, find the same recording
  // in the lossless (Tidal-backed) catalogue and report ISRC + hi-res
  // availability. Catalogue metadata only; no stream resolution. Sits beside
  // the existing Spotify->Saavn matcher rather than replacing it.
  fastify.register(matcherRoutes, { prefix: '/match' });

  // Lossless downloads — Qobuz, Tidal and Amazon engines ported from the
  // ClashFLAC server. FLAC is retagged in flight and streamed straight to the
  // client, so a 40 MB hi-res track never lands in memory or on disk.
  // Credentials come from the env; endpoints answer 503 when absent.
  fastify.register(losslessRoutes, { prefix: '/lossless' });

  // Other Services
  fastify.register(lyricsRoutes, { prefix: '/lyrics' });
  fastify.register(liveMusicRoutes, { prefix: '/live' });
  // Podcasts — backed by PodcastIndex.org via HMAC-style auth (the
  // creds stay server-side in process.env). Mappers normalise to the
  // unified FeedItem schema with `type: 'podcast'` for shows and
  // `type: 'episode'` for episodes; episode `mediaUrls[0].link` is the
  // raw enclosure URL so the Flutter resolver plays it directly.
  fastify.register(podcastRoutes, { prefix: '/podcasts' });

  // Internet radio — thin proxy over the sunoh-radio service (separate
  // repo, runs on localhost:4000 alongside this API on the VPS). Curated
  // PostgreSQL catalog of ~50 k working stations + facet counts;
  // see SUNOH_RADIO_BASE_URL in .env to point elsewhere.
  fastify.register(radioRoutes, { prefix: '/radios' });

  // Audiobooks — backed by cozyaudiobooks.com (WordPress REST + AJAX
  // search + per-post HTML scrape for cover/author/chapters). All hot
  // paths Redis-cached; home aggregator parallel-enriches ~50 books
  // cold then serves instant for 1 h. Chapter mediaUrls inline so the
  // stream resolver short-circuits to tier-1 on play.
  fastify.register(audiobookRoutes, { prefix: '/audiobooks' });

  done();
};

export default entry;
