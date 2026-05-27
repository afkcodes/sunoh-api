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

import type { HomeSection } from '../types';
import { sendError, sendSuccess } from '../utils/response';
import { podcastIndexConfigured, podcastIndexFetch } from './client';
import { mapPodcastEpisode, mapPodcastEpisodes, mapPodcastShow, mapPodcastShows } from './mappers';

const SOURCE = 'podcastindex';

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
