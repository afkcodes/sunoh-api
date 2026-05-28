// PodcastIndex.org → unified API surface.
//
// Every handler:
//   1. Short-circuits with 503 if the PodcastIndex creds aren't
//      configured (clearer than letting upstream return 401).
//   2. Calls `podcastIndexFetch(path, params)` — the client owns the
//      auth headers + URL building.
//   3. Maps the response to the unified FeedItem shape via the
//      `mapPodcast*` helpers so the Flutter client's existing
//      `FeedItem.fromJson` parses everything without provider-specific
//      branches.
//   4. Wraps the result in `sendSuccess` / `sendError` so the envelope
//      matches the rest of sunoh-api.

import type { FastifyReply, FastifyRequest } from 'fastify';

import { cache } from '../redis';
import type { HomeSection, PodcastShow } from '../types';
import { sendError, sendSuccess } from '../utils/response';
import { podcastIndexConfigured, podcastIndexFetch } from './client';
import { appleTopByGenre, appleTopOverall, type AppleChartEntry } from './itunes';
import { mapPodcastEpisode, mapPodcastEpisodes, mapPodcastShow, mapPodcastShows } from './mappers';

const SOURCE = 'podcastindex';

// Country-scoped editorial mix for the /podcasts/home aggregator.
//
// `appleCode` is the lowercase ISO-3166 alpha-2 used in Apple's URLs
// (Apple uses storefront codes; they match ISO for the countries we care
// about). `label` flavours section headings ("Top podcasts in India").
// `sections` defines the genre rows that follow the "Top podcasts"
// hero — each one fetches Apple's per-genre top chart.
//
// Switched from PodcastIndex's /podcasts/trending (feed-activity driven,
// surfaced too much SEO noise) to Apple's curated charts (editorial +
// real listening data, per storefront). The iTunes IDs Apple returns are
// then resolved back through PodcastIndex's /podcasts/byitunesid so
// playback, episodes, and search keep using the same provider.
//
// Apple genre IDs (iTunes Podcast taxonomy — superset documented in
// itunes.ts):
//   1303 Comedy · 1304 Education · 1310 Music · 1311 News
//   1314 Religion & Spirituality · 1315 Science · 1316 Sports
//   1318 Technology · 1321 Business · 1324 Society & Culture
//   1480 Arts · 1488 History · 1489 Fiction · 1545 True Crime
interface HomeSectionConfig {
  heading: string;
  genreId?: string; // undefined → top-overall chart
}
const COUNTRY_CONFIG: Record<
  string,
  { label: string; appleCode: string; sections: HomeSectionConfig[] }
> = {
  IN: {
    label: 'India',
    appleCode: 'in',
    sections: [
      { heading: 'Top podcasts in India' },
      { heading: 'News', genreId: '1311' },
      { heading: 'Comedy', genreId: '1303' },
      { heading: 'Society & Culture', genreId: '1324' },
      { heading: 'Business', genreId: '1321' },
      { heading: 'Education', genreId: '1304' },
    ],
  },
  US: {
    label: 'US',
    appleCode: 'us',
    sections: [
      { heading: 'Top podcasts' },
      { heading: 'News', genreId: '1311' },
      { heading: 'Comedy', genreId: '1303' },
      { heading: 'Technology', genreId: '1318' },
      { heading: 'Business', genreId: '1321' },
      { heading: 'Society & Culture', genreId: '1324' },
    ],
  },
};
const DEFAULT_COUNTRY = 'IN';

/** Per-section tile count fetched from Apple. We over-fetch slightly
 *  vs the final visible count because byitunesid sometimes misses
 *  (the show isn't in PodcastIndex) — over-fetching keeps each section
 *  full after misses. */
const APPLE_FETCH_COUNT = 20;
/** Final cap on tiles per section after PodcastIndex resolution. */
const PER_SECTION_CAP = 12;

/**
 * Resolve a batch of Apple chart entries to PodcastIndex shows.
 *
 * Apple gives us iTunes IDs; everything else (episodes, playback,
 * subscriptions) flows through PodcastIndex which keys by its own feed
 * id. `/podcasts/byitunesid?id={id}` is the bridge: one call per id,
 * returns the same `feed` object that `/podcasts/byfeedid` does, so
 * `mapPodcastShow` handles both unchanged.
 *
 * Results are cached per-id for 7 d in Redis — show metadata barely
 * changes day to day, and an iTunes id is a stable identifier across
 * the entire system. With the cache warm, a home request resolves to
 * ~0 PodcastIndex calls; cold, ~12 per section.
 *
 * Entries that PodcastIndex doesn't have are dropped silently (their
 * mapped show would be useless — no feed id, no episodes).
 */
async function resolveByItunesIds(entries: AppleChartEntry[]): Promise<PodcastShow[]> {
  if (entries.length === 0) return [];
  const keys = entries.map((e) => `podcast_byitunes_v1_${e.itunesId}`);

  // 1) Multi-get from cache up front so warm hits cost zero round trips.
  let cached: Array<PodcastShow | null> = entries.map(() => null);
  try {
    const got = await cache.getMany<PodcastShow>(keys);
    if (Array.isArray(got) && got.length === entries.length) cached = got;
  } catch {
    /* cache offline — fall through */
  }

  // 2) Fetch only the gaps from PodcastIndex, in parallel.
  const misses = entries.map((e, i) => ({ e, i })).filter(({ i }) => !cached[i]);
  const fetched = await Promise.allSettled(
    misses.map(({ e }) => podcastIndexFetch('/podcasts/byitunesid', { id: e.itunesId })),
  );
  const newlyResolved: Array<{ idx: number; show: PodcastShow }> = [];
  fetched.forEach((r, k) => {
    const { i } = misses[k];
    if (r.status !== 'fulfilled' || !r.value.ok || !r.value.data?.feed) return;
    const feed = r.value.data.feed;
    // PodcastIndex returns a non-null `feed` even when the show isn't in
    // the index, but its `id` is 0 and `title` is empty. Filter those.
    if (!feed.id || !feed.title) return;
    const show = mapPodcastShow(feed);
    newlyResolved.push({ idx: i, show });
  });

  // 3) Write fresh entries back to cache via pipelined setMany.
  if (newlyResolved.length > 0) {
    const writes: Record<string, PodcastShow> = {};
    newlyResolved.forEach(({ idx, show }) => {
      writes[keys[idx]] = show;
      cached[idx] = show;
    });
    try {
      await cache.setMany(writes, 60 * 60 * 24 * 7);
    } catch {
      /* cache write blip — ignore */
    }
  }

  // 4) Preserve Apple's chart order — that's the editorial signal we
  // came here for. Drop misses (nulls).
  return cached.filter((s): s is PodcastShow => s !== null);
}

/**
 * Best-effort country resolution for the /podcasts/home aggregator.
 * Returns an ISO-3166 alpha-2 code (uppercase) that the caller can
 * look up in `COUNTRY_CONFIG`; falls back to [DEFAULT_COUNTRY] when
 * nothing matches a configured country.
 *
 * Resolution order:
 *   1. Explicit `?country=XX` query — Flutter sends this from the
 *      device locale; trumps everything else.
 *   2. CF-IPCountry header — set by Cloudflare's edge when the host
 *      is orange-clouded. `api.sunoh.online` is currently grey-clouded
 *      (DNS only) so this is a no-op in prod today, but kept as a
 *      zero-cost upgrade path: orange-cloud the record + this works
 *      with no code change.
 *   3. IP-geo lookup via ip-api.com — runs only on cache miss; the
 *      IP→country mapping is cached in Redis for 24 h per source IP.
 *      ip-api free tier: 45 req/min, no signup. The 24 h IP cache
 *      means even a busy session does one lookup max per IP.
 *   4. Accept-Language locale tag (`en-IN` → `IN`) — last-ditch.
 *      Browsers send this; Flutter / curl typically don't.
 *   5. DEFAULT_COUNTRY (`IN`).
 */
async function resolveCountry(req: FastifyRequest, explicit?: string): Promise<string> {
  const upper = (v: string | undefined): string | undefined =>
    v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : undefined;
  // 1. Explicit ?country=
  const q = upper(explicit);
  if (q && COUNTRY_CONFIG[q]) return q;
  // 2. Cloudflare geo header (no-op today; future-proofing)
  const cf = upper(req.headers['cf-ipcountry'] as string | undefined);
  if (cf && cf !== 'XX' && COUNTRY_CONFIG[cf]) return cf;
  // 3. IP-geo lookup via ip-api.com
  const ip = clientIp(req);
  if (ip) {
    const geo = await ipToCountry(ip);
    if (geo && COUNTRY_CONFIG[geo]) return geo;
  }
  // 4. Accept-Language locale tag
  const accept = (req.headers['accept-language'] as string | undefined) || '';
  const m = accept.split(',')[0]?.match(/-([A-Z]{2})/i);
  const al = upper(m?.[1]);
  if (al && COUNTRY_CONFIG[al]) return al;
  return DEFAULT_COUNTRY;
}

/**
 * Strongest signal first: CF-Connecting-IP (if behind CF), then
 * X-Forwarded-For's first hop (nginx in front of node), then the raw
 * Fastify socket IP. Returns null for loopback / private ranges so we
 * don't bother ip-api with addresses it can't geolocate (it would
 * return `status: 'fail'` for private IPs and still count against the
 * rate limit).
 */
function clientIp(req: FastifyRequest): string | null {
  const headerIp =
    (req.headers['cf-connecting-ip'] as string | undefined) ||
    (req.headers['x-real-ip'] as string | undefined) ||
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim();
  const ip = headerIp || req.ip;
  if (!ip) return null;
  // Skip private / loopback so we don't waste a rate-limit slot. Covers
  // 127/8, 10/8, 172.16/12, 192.168/16, and IPv6 link-local / loopback.
  if (
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip) ||
    ip === '::1' ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  ) {
    return null;
  }
  return ip;
}

/**
 * Cached IP→ISO country lookup via ip-api.com. 24 h Redis TTL — a
 * device's IP→country rarely changes mid-day; for the rare case where
 * the user crosses a border, a day's stale answer is harmless (the
 * podcasts home cache itself is only 1 h, so they'd see the fresh
 * regional mix within a day max).
 *
 * Returns null on any failure (network, parse, rate limit) — the
 * caller falls through to the next resolution step rather than 500ing.
 */
async function ipToCountry(ip: string): Promise<string | null> {
  const key = `podcasts_geo_v1_${ip}`;
  try {
    const cached = (await cache.get(key)) as string | null;
    if (cached === 'XX') return null; // negative-cache a known miss
    if (cached) return cached;
  } catch {
    /* cache offline — fall through to live lookup */
  }
  try {
    // ip-api free tier — IPv4 + IPv6, HTTP only on the free endpoint
    // (HTTPS is the paid tier). The server is making this call, not
    // the client, so the lack of TLS is acceptable; the response is
    // only used to pick a country code, no PII flows.
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      countryCode?: string;
    };
    if (body.status !== 'success' || !body.countryCode) {
      try {
        await cache.set(key, 'XX', 60 * 60 * 24); // 1-day negative cache
      } catch {
        /* swallow */
      }
      return null;
    }
    const cc = body.countryCode.toUpperCase();
    try {
      await cache.set(key, cc, 60 * 60 * 24);
    } catch {
      /* swallow */
    }
    return cc;
  } catch {
    return null;
  }
}

function ensureConfigured(res: FastifyReply): boolean {
  if (!podcastIndexConfigured()) {
    sendError(
      res,
      'Podcasts backend not configured (PODCASTINDEX_KEY / PODCASTINDEX_SECRET missing). ' +
        'Set them in the server env and restart.',
      null,
      503,
    );
    return false;
  }
  return true;
}

// ── Discovery ──────────────────────────────────────────────────────────

/**
 * GET /podcasts/trending — currently-trending shows.
 *
 * Query params (all optional, all forwarded to PodcastIndex):
 *   max=N        — page size (default 10, upstream cap 1000)
 *   since=epoch  — only feeds with newer items than this unix-seconds time
 *   lang=en,hi   — comma-separated ISO codes
 *   cat=News     — filter by category (name or numeric id)
 */
export const podcastsTrendingController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const q = req.query as any;
  const upstream = await podcastIndexFetch('/podcasts/trending', {
    max: q.max ?? 20,
    since: q.since,
    lang: q.lang,
    cat: q.cat,
    notcat: q.notcat,
  });
  if (!upstream.ok) return sendError(res, upstream.error || 'Trending fetch failed', null, 502);
  const shows = mapPodcastShows(upstream.data?.feeds);
  return sendSuccess(res, { list: shows, count: shows.length }, 'Trending podcasts', SOURCE);
};

/**
 * GET /podcasts/recent — recently updated feeds across the index.
 * Backed by PodcastIndex's `/recent/feeds`. Different from trending —
 * trending is curated by recent activity heuristics; recent is just
 * "newest items in the index right now."
 */
export const podcastsRecentController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const q = req.query as any;
  const upstream = await podcastIndexFetch('/recent/feeds', {
    max: q.max ?? 20,
    since: q.since,
    lang: q.lang,
    cat: q.cat,
  });
  if (!upstream.ok) return sendError(res, upstream.error || 'Recent fetch failed', null, 502);
  const shows = mapPodcastShows(upstream.data?.feeds);
  return sendSuccess(res, { list: shows, count: shows.length }, 'Recent podcasts', SOURCE);
};

/**
 * GET /podcasts/categories — full taxonomy of categories PodcastIndex
 * supports. Returns the raw `{id, name}` pairs since these are stable
 * + small (~110 entries) and the Flutter side will use both fields.
 */
export const podcastsCategoriesController = async (_req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const upstream = await podcastIndexFetch('/categories/list');
  if (!upstream.ok) {
    return sendError(res, upstream.error || 'Categories fetch failed', null, 502);
  }
  const feeds = (upstream.data?.feeds || []) as { id: number; name: string }[];
  return sendSuccess(res, { list: feeds, count: feeds.length }, 'Categories', SOURCE);
};

/**
 * GET /podcasts/by-category/:slug?max=N — shows in a category, ordered
 * by trend / recency.
 *
 * PodcastIndex has no dedicated category-listing endpoint; only
 * `/podcasts/trending?cat=` and `/recent/feeds?cat=` accept a category
 * filter. `/podcasts/bytag` is a different concept (filters by the
 * `<podcast:value>` V4V tag, not category) and was a wrong-tree attempt
 * — calling it returned random podcasts irrespective of the slug.
 *
 * The `slug` path param can be a category name (`News`) or its numeric
 * id (`55`); PodcastIndex's `cat=` accepts both.
 */
export const podcastsByCategoryController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const { slug } = req.params as any;
  const q = req.query as any;
  // Trending-with-category is the discovery surface most users want:
  // sorted by activity, restricted to the category. recent+cat is the
  // alternative (purely chronological) if we ever expose a "what's new
  // in News this hour" surface.
  const upstream = await podcastIndexFetch('/podcasts/trending', {
    max: q.max ?? 30,
    cat: slug,
    lang: q.lang,
  });
  if (!upstream.ok) {
    return sendError(res, upstream.error || 'Category fetch failed', null, 502);
  }
  const shows = mapPodcastShows(upstream.data?.feeds);
  return sendSuccess(
    res,
    { list: shows, count: shows.length, category: slug },
    `Podcasts in ${slug}`,
    SOURCE,
  );
};

// ── Search / show / episodes ──────────────────────────────────────────

/**
 * GET /podcasts/search?q=…&max=N — full-text search by term.
 * PodcastIndex's `/search/byterm` ranks by relevance.
 */
export const podcastsSearchController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const q = req.query as any;
  const term = (q.q || q.query || '').toString().trim();
  if (!term) return sendError(res, 'Missing required query parameter `q`', null, 400);
  const upstream = await podcastIndexFetch('/search/byterm', {
    q: term,
    max: q.max ?? 30,
    similar: q.similar,
    fulltext: true,
  });
  if (!upstream.ok) return sendError(res, upstream.error || 'Search failed', null, 502);
  const shows = mapPodcastShows(upstream.data?.feeds);
  return sendSuccess(
    res,
    { list: shows, count: shows.length, query: term },
    'Search results',
    SOURCE,
  );
};

/**
 * GET /podcasts/:id — show detail + its latest episodes.
 *
 * Bundles two upstream calls (`/podcasts/byfeedid` + `/episodes/byfeedid`)
 * so the Flutter detail screen needs only one round trip to render the
 * hero + first page of episodes. Episodes default to 30 most recent.
 */
export const podcastShowController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const { id } = req.params as any;
  if (!id) return sendError(res, 'Missing path param `id`', null, 400);
  const q = req.query as any;
  const [showRes, episodesRes] = await Promise.all([
    podcastIndexFetch('/podcasts/byfeedid', { id }),
    podcastIndexFetch('/episodes/byfeedid', {
      id,
      max: q.max ?? 30,
      since: q.since,
    }),
  ]);
  if (!showRes.ok || !showRes.data?.feed) {
    return sendError(res, showRes.error || 'Show fetch failed', null, 502);
  }
  const show = mapPodcastShow(showRes.data.feed);
  const episodes = episodesRes.ok ? mapPodcastEpisodes(episodesRes.data?.items) : [];
  // Match the album/playlist detail shape — single object with embedded
  // `songs` (here `episodes`) — so the Flutter side can reuse the
  // _AlbumLikeBody renderer.
  return sendSuccess(
    res,
    {
      ...show,
      episodes,
      episodeCount: episodes.length,
    },
    'Show + recent episodes',
    SOURCE,
  );
};

/**
 * GET /podcasts/:id/episodes?max=N&since=epoch — paginated episode list.
 * Used when the Flutter detail screen wants to load more than the
 * initial 30 episodes the bundled show endpoint returned.
 */
export const podcastEpisodesController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const { id } = req.params as any;
  if (!id) return sendError(res, 'Missing path param `id`', null, 400);
  const q = req.query as any;
  const upstream = await podcastIndexFetch('/episodes/byfeedid', {
    id,
    max: q.max ?? 50,
    since: q.since,
    enclosure: q.enclosure,
  });
  if (!upstream.ok) return sendError(res, upstream.error || 'Episodes fetch failed', null, 502);
  const episodes = mapPodcastEpisodes(upstream.data?.items);
  return sendSuccess(res, { list: episodes, count: episodes.length }, 'Episodes', SOURCE);
};

/**
 * GET /podcasts/episode/:guid — episode detail by GUID.
 *
 * Routed via guid (not numeric id) because PodcastIndex's `/episodes/
 * byguid` is the most reliable lookup — episode ids can shift on feed
 * re-imports. Carries chaptersUrl + transcriptUrl when available so a
 * future chapters / transcripts UI can fetch them directly.
 */
export const podcastEpisodeController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const { guid } = req.params as any;
  const q = req.query as any;
  if (!guid && !q.id) {
    return sendError(res, 'Either `guid` (path) or `id` (query) is required', null, 400);
  }
  // Prefer guid; fall back to id when guid lookup yields nothing.
  let upstream = guid
    ? await podcastIndexFetch('/episodes/byguid', { guid, feedurl: q.feedurl, feedid: q.feedid })
    : ({ ok: false, status: 0 } as any);
  if (!upstream.ok && q.id) {
    upstream = await podcastIndexFetch('/episodes/byid', { id: q.id });
  }
  if (!upstream.ok) return sendError(res, upstream.error || 'Episode fetch failed', null, 502);
  const raw = upstream.data?.episode;
  if (!raw) return sendError(res, 'Episode not found', null, 404);
  return sendSuccess(res, mapPodcastEpisode(raw), 'Episode', SOURCE);
};

// ── Aggregator ────────────────────────────────────────────────────────

/**
 * GET /podcasts/home?country=IN — multi-section feed for the Podcasts
 * tab in one round trip. Returns a `HomeSection[]` shaped like
 * `/music/home`, so the Flutter side can reuse the same section
 * renderer.
 *
 * Sections (per-country, from COUNTRY_CONFIG):
 *   - Top podcasts in <country>          (Apple top-overall chart)
 *   - <Genre 1>                          (Apple top by genre)
 *   - <Genre 2>                          (Apple top by genre)
 *   - …
 *
 * Data flow per section:
 *   1. Apple chart → list of iTunes IDs (24 h cache).
 *   2. iTunes IDs → PodcastIndex shows via /podcasts/byitunesid
 *      (7 d cache per id).
 *   3. Trim each section to PER_SECTION_CAP and drop intra-response
 *      duplicates (first-section-wins).
 *
 * Cache strategy:
 *   - Final response cached 6 h per country. Apple's charts update at
 *     most daily so 6 h is comfortably fresh without thrashing the
 *     upstream chain on a tight cadence.
 *   - Underlying caches (per-genre Apple JSON, per-id PodcastIndex show)
 *     survive the home-response eviction, so warming this section back
 *     up is nearly free even after the 6 h TTL fires.
 *
 * Failure handling: each upstream call goes through Promise.allSettled
 * so one bad section (Apple chart 503, PodcastIndex blip) doesn't 502
 * the whole page. Empty sections drop out of the response.
 */
export const podcastsHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  if (!ensureConfigured(res)) return;
  const q = req.query as any;
  // Country resolution priority — see resolveCountry's docstring.
  const country = await resolveCountry(req, q.country as string | undefined);
  const cfg = COUNTRY_CONFIG[country] || COUNTRY_CONFIG[DEFAULT_COUNTRY];
  const cacheKey = `podcasts_home_v2_${country}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
  } catch {
    /* cache offline → refetch. Don't 500 on a miss. */
  }

  // 1) Fan out the Apple chart fetches in parallel. APPLE_FETCH_COUNT
  // is a bit larger than PER_SECTION_CAP so we have headroom after
  // dropping iTunes-IDs PodcastIndex doesn't know about.
  const appleResults = await Promise.allSettled(
    cfg.sections.map((s) =>
      s.genreId
        ? appleTopByGenre(cfg.appleCode, s.genreId, APPLE_FETCH_COUNT)
        : appleTopOverall(cfg.appleCode, APPLE_FETCH_COUNT),
    ),
  );

  // 2) Resolve each section's iTunes IDs → PodcastIndex shows.
  // Sections resolve in parallel; within a section, resolveByItunesIds
  // does its own batched cache + parallel fetch.
  const resolved = await Promise.all(
    appleResults.map(async (r) => {
      if (r.status !== 'fulfilled' || r.value.length === 0) return [];
      return resolveByItunesIds(r.value);
    }),
  );

  // 3) Build the section list, dedup across sections (first wins so
  // the most-prominent section keeps an overlapping show — Apple's
  // overall top + News will share The Daily-type hits otherwise).
  const seenIds = new Set<string>();
  const sections: HomeSection[] = [];
  resolved.forEach((shows, i) => {
    const filtered: PodcastShow[] = [];
    for (const s of shows) {
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      filtered.push(s);
      if (filtered.length >= PER_SECTION_CAP) break;
    }
    if (filtered.length === 0) return;
    sections.push({
      heading: cfg.sections[i].heading,
      data: filtered,
      source: SOURCE,
    });
  });

  if (sections.length === 0) {
    return sendError(res, 'No sections returned from upstream', null, 502);
  }

  try {
    await cache.set(cacheKey, sections, 60 * 60 * 6);
  } catch {
    /* cache write blip — return the response anyway */
  }

  return sendSuccess(res, sections, `Podcasts home (${country})`, SOURCE);
};
