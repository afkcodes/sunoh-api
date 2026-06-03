// Audiobooks endpoints.
//
// Backed by cozyaudiobooks.com via thin WordPress REST proxies +
// HTML-scrape enrichment for cover/author/chapters. All hot paths are
// Redis-cached so the cold-load HTML scrape cost is paid once per
// resource per TTL window.

import type { FastifyReply, FastifyRequest } from 'fastify';

import { cache } from '../redis';
import type { HomeSection } from '../types';
import { sendError, sendSuccess } from '../utils/response';
import { cozyHtml, cozyJson } from './client';
import { mapChapterToFeedItem, mapPostToFeedItem, mapSearchHitToFeedItem } from './mappers';
import { parsePost } from './scraper';
import type { CozySearchHit, ScrapedPost, WpCategory, WpPost } from './types';

const SOURCE = 'cozyaudiobooks';

// ── Home configuration ───────────────────────────────────────────────────
//
// Fixed sections — predictable + cache-friendly. If we ever want
// rotation, just rewrite this constant with a per-day picker. The home
// gets warmed every 50 min by the route so users effectively never see
// a cold path even though the cache TTL is 60 min.

const HOME_HERO_SIZE = 6;
const HOME_STRIP_SIZE = 10;

const HOME_STRIPS: { heading: string; categoryId: number }[] = [
  { heading: 'Mystery', categoryId: 39 },
  { heading: 'Fantasy', categoryId: 8 },
  { heading: 'Romance', categoryId: 29 },
  { heading: 'Thriller & Suspense', categoryId: 110 },
  { heading: 'Bestsellers', categoryId: 11 },
];

const BROWSE_GENRES_PREVIEW_COUNT = 12;

// ── Cache keys + TTLs ────────────────────────────────────────────────────

// Cache version bumped from _v1 → _v2 to invalidate two earlier-shipped
// bugs in one go:
//   - per-post: author scrape was matching WP `<meta name=author>` →
//     always "admin". Real author lives in the schema.org Person graph;
//     fixed in scraper.ts.
//   - categories: controller returned raw WP rows (yoast_head, meta,
//     taxonomy, …) instead of the flat {id, name, slug, count} shape.
//   - home + by-category transitively held the bad author payload.
const HOME_KEY = 'audiobooks_home_v2';
const HOME_TTL = 60 * 60; // 1 h
const CATEGORIES_KEY = 'audiobooks_categories_v2';
const CATEGORIES_TTL = 60 * 60 * 24; // 24 h — near-static
const BY_CATEGORY_KEY = (id: number, page: number, limit: number) =>
  `audiobooks_cat_${id}_p${page}_l${limit}_v2`;
const BY_CATEGORY_TTL = 60 * 60; // 1 h
const POST_KEY = (slug: string) => `audiobooks_post_${slug}_v2`;
const POST_TTL = 60 * 60 * 24; // 24 h — chapter URLs are stable
const SEARCH_KEY = (q: string) => `audiobooks_search_${q.toLowerCase()}_v2`;
const SEARCH_TTL = 60 * 10; // 10 min — fresh enough for live UX

/** Concurrency cap for parallel HTML scrapes. cozyaudiobooks rate-limits
 *  loosely around 2 r/s; 10 in-flight is a comfortable ceiling that
 *  finishes a 50-book home warmup in ~6 s without 429ing. */
const SCRAPE_CONCURRENCY = 10;

// ── Helpers ──────────────────────────────────────────────────────────────

const slugFromLink = (link: string): string => {
  const m = /cozyaudiobooks\.com\/([^/?#]+)/i.exec(link);
  return m ? m[1] : link;
};

/** Scrape a single post page → enriched detail. Caches the full
 *  ScrapedPost (cover + author + audio + chapters) for 24 h. Called
 *  by:
 *    - home/strip enrichment (only reads cover + author from the result)
 *    - detail endpoint (uses everything)
 *    - by-category lazy enrichment (cover only) */
async function scrapeAndCachePost(link: string): Promise<ScrapedPost | null> {
  const slug = slugFromLink(link);
  const cached = await cache.get<ScrapedPost>(POST_KEY(slug));
  if (cached) return cached;
  const res = await cozyHtml(link);
  if (!res.ok || !res.data) return null;
  const scraped = parsePost(res.data);
  await cache.set(POST_KEY(slug), scraped, POST_TTL);
  return scraped;
}

/** Map a `Promise<T>`-producing factory over an array with a hard
 *  concurrency cap. Used to parallelise scrapes during home warmup
 *  without blowing past the upstream's polite rate ceiling. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Fetch a strip of posts (latest in a category) and enrich them in
 *  parallel. Returns an empty array if the upstream call fails — the
 *  controller decides whether that's worth a section drop. */
async function fetchEnrichedStrip(
  categoryId: number | undefined,
  perPage: number,
): Promise<ReturnType<typeof mapPostToFeedItem>[]> {
  const upstream = await cozyJson<WpPost[]>('/wp-json/wp/v2/posts', {
    categories: categoryId,
    per_page: perPage,
    orderby: 'date',
    order: 'desc',
  });
  if (!upstream.ok || !upstream.data) return [];
  const enrichments = await mapWithConcurrency(upstream.data, SCRAPE_CONCURRENCY, (p) =>
    scrapeAndCachePost(p.link),
  );
  return upstream.data.map((post, i) =>
    mapPostToFeedItem(post, { scraped: enrichments[i] ?? null }),
  );
}

// ── GET /audiobooks/home ─────────────────────────────────────────────────

/** Multi-section home: hero (latest) + browse-genres preview + 5 genre
 *  strips. ~56 HTML scrapes cold, ~6 s parallel. Cached 1 h. */
export const audiobooksHomeController = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    const cached = await cache.get<HomeSection[]>(HOME_KEY);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
  } catch {
    /* cache offline — refetch */
  }

  // Hero (latest across all categories) + 5 genre strips run in
  // parallel — independent upstream calls.
  const [hero, ...strips] = await Promise.all([
    fetchEnrichedStrip(undefined, HOME_HERO_SIZE),
    ...HOME_STRIPS.map((s) => fetchEnrichedStrip(s.categoryId, HOME_STRIP_SIZE)),
  ]);

  // Browse-genres preview tile row uses the categories endpoint, no
  // enrichment needed (counts inline).
  const cats = await getCategoriesCached();
  const browseTiles = cats.slice(0, BROWSE_GENRES_PREVIEW_COUNT).map((c) => ({
    id: String(c.id),
    title: c.name,
    subtitle: `${c.count} book${c.count === 1 ? '' : 's'}`,
    type: 'audiobook_category' as const,
    image: [],
    source: SOURCE,
    slug: c.slug,
    count: c.count,
  }));

  const sections: HomeSection[] = [];
  if (hero.length > 0) {
    sections.push({ heading: 'Latest additions', data: hero as any, source: SOURCE });
  }
  if (browseTiles.length > 0) {
    sections.push({
      heading: 'Browse genres',
      data: browseTiles as any,
      source: SOURCE,
    });
  }
  HOME_STRIPS.forEach((s, i) => {
    if (strips[i].length > 0) {
      sections.push({ heading: s.heading, data: strips[i] as any, source: SOURCE });
    }
  });

  if (sections.length === 0) {
    return sendError(res, 'No sections returned from upstream', null, 502);
  }
  try {
    await cache.set(HOME_KEY, sections, HOME_TTL);
  } catch {
    /* cache write blip — return anyway */
  }
  return sendSuccess(res, sections, 'Audiobooks home', SOURCE);
};

// ── GET /audiobooks/categories ───────────────────────────────────────────

/** Flat client-facing shape — strips raw WP rows (yoast_head HTML,
 *  ld+json schema, meta, acf, taxonomy, parent, link, …) down to what
 *  the Flutter side actually reads. Names are HTML-entity-decoded
 *  server-side so the client doesn't have to. */
interface AudiobookCategoryClean {
  id: number;
  name: string;
  slug: string;
  count: number;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

/** All categories sorted by post count desc. Cached 24 h — drives the
 *  full genres grid screen when the user taps "See all" on the home. */
async function getCategoriesCached(): Promise<AudiobookCategoryClean[]> {
  const cached = await cache.get<AudiobookCategoryClean[]>(CATEGORIES_KEY);
  if (cached) return cached;
  const upstream = await cozyJson<WpCategory[]>('/wp-json/wp/v2/categories', {
    per_page: 100,
    orderby: 'count',
    order: 'desc',
  });
  if (!upstream.ok || !upstream.data) return [];
  const cleaned: AudiobookCategoryClean[] = upstream.data
    // Drop the "Uncategorized" bucket — it's 7000+ posts of mixed junk
    // and isn't a real genre.
    .filter((c) => c.slug !== 'uncategorized' && c.count > 0)
    .map((c) => ({
      id: c.id,
      name: decodeEntities(c.name),
      slug: c.slug,
      count: c.count,
    }));
  await cache.set(CATEGORIES_KEY, cleaned, CATEGORIES_TTL);
  return cleaned;
}

export const audiobooksCategoriesController = async (_req: FastifyRequest, res: FastifyReply) => {
  const cats = await getCategoriesCached();
  if (cats.length === 0) {
    return sendError(res, 'Categories fetch failed', null, 502);
  }
  return sendSuccess(res, cats, 'Audiobook categories', SOURCE);
};

// ── GET /audiobooks/by-category?id=…&page=…&limit=… ──────────────────────

/** Paginated post listing for a single category. Skeleton-only — no
 *  cover/author scrape — because the Flutter side lazy-enriches each
 *  tile as it scrolls into view via /audiobooks/:id. First scroll
 *  through is slow per tile (1 HTTP + scrape per book), but Redis
 *  caches each scrape for 24 h so subsequent users get it instant. */
export const audiobooksByCategoryController = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { id?: string; page?: string; limit?: string };
  const idNum = Number(q.id);
  if (!idNum || Number.isNaN(idNum)) {
    return sendError(res, 'Missing or invalid query param `id`', null, 400);
  }
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));

  const key = BY_CATEGORY_KEY(idNum, page, limit);
  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
  } catch {
    /* fall through */
  }

  const upstream = await cozyJson<WpPost[]>('/wp-json/wp/v2/posts', {
    categories: idNum,
    page,
    per_page: limit,
    orderby: 'date',
    order: 'desc',
  });
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Category fetch failed', null, 502);
  }
  const items = upstream.data.map((p) => mapPostToFeedItem(p, { scraped: null }));
  const payload = { list: items, count: items.length, page, limit };
  try {
    await cache.set(key, payload, BY_CATEGORY_TTL);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, payload, `Audiobooks · category ${idNum}`, SOURCE);
};

// ── GET /audiobooks/search?q=… ───────────────────────────────────────────

/** Live search via the custom AJAX handler. Already returns covers +
 *  authors inline → no enrichment cost. Empty `q` is rejected with
 *  400 (cozy_search itself returns junk on short queries). */
export const audiobooksSearchController = async (req: FastifyRequest, res: FastifyReply) => {
  const q = (req.query as { q?: string }).q?.trim() ?? '';
  if (q.length < 2) {
    return sendError(res, 'Search `q` must be ≥ 2 chars', null, 400);
  }
  const key = SEARCH_KEY(q);
  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
  } catch {
    /* fall through */
  }
  const upstream = await cozyJson<CozySearchHit[]>('/wp-admin/admin-ajax.php', {
    action: 'cozy_search',
    q,
  });
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Search failed', null, 502);
  }
  const items = upstream.data.map(mapSearchHitToFeedItem);
  const payload = { list: items, count: items.length };
  try {
    await cache.set(key, payload, SEARCH_TTL);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, payload, `Audiobook search "${q}"`, SOURCE);
};

// ── GET /audiobooks/:slug ────────────────────────────────────────────────

/** Full enriched detail for one audiobook: cover + author + chapters
 *  (each chapter mapped to a play-ready FeedItem with mediaUrls inline).
 *  Also used by the Flutter side to lazy-enrich tiles on the by-category
 *  screen — those callers ignore `chapters` and just read `cover` /
 *  `subtitle`. */
export const audiobookDetailController = async (req: FastifyRequest, res: FastifyReply) => {
  const { slug } = req.params as { slug?: string };
  if (!slug) return sendError(res, 'Missing path param `slug`', null, 400);

  // Resolve slug → post URL. The slug embeds the WP permalink so this
  // is just a string template; no upstream lookup needed.
  const link = `https://cozyaudiobooks.com/${slug}/`;

  const scraped = await scrapeAndCachePost(link);
  if (!scraped) {
    return sendError(res, 'Audiobook not found', null, 404);
  }

  const title = decodeURIComponent(slug)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const chapters = scraped.chapters.map((ch) =>
    mapChapterToFeedItem({
      bookId: slug,
      bookTitle: title,
      author: scraped.author,
      cover: scraped.cover,
      chapter: ch,
    }),
  );

  return sendSuccess(
    res,
    {
      id: slug,
      title,
      subtitle: scraped.author,
      type: 'audiobook' as const,
      image: scraped.cover ? [{ quality: '500x500', link: scraped.cover }] : [],
      source: SOURCE,
      link,
      author: scraped.author,
      cover: scraped.cover,
      audioUrl: scraped.audioUrl,
      chapters,
      chapterCount: chapters.length,
    },
    'Audiobook detail',
    SOURCE,
  );
};
