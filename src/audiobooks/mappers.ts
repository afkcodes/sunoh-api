// WordPress post / Cozy search hit / scraped detail → unified
// FeedItem-style shape the Flutter app already renders.
//
// Two FeedItem flavours come out of this module:
//   `type: 'audiobook'`  — a book tile. Used in home strips, category
//                          drilldown, search results.
//   `type: 'song'`       — one chapter. Used in the queue when the
//                          user taps a chapter on the detail screen.
//                          The existing player UI + queue / autoplay
//                          machinery wants `type: 'song'`; using a
//                          new value would require touching the
//                          renderer everywhere.

import type { CozySearchHit, ScrapedChapter, ScrapedPost, WpPost } from './types';

const SOURCE = 'cozyaudiobooks';

const decodeHtml = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const slugFromLink = (link: string): string => {
  // `https://cozyaudiobooks.com/<slug>/` → `<slug>`. Falls back to the
  // full URL if the shape doesn't match — better than empty.
  const m = /cozyaudiobooks\.com\/([^/?#]+)/i.exec(link);
  return m ? m[1] : link;
};

interface MapPostOptions {
  /** Optional enrichment from a prior scrape — cover + author. When
   *  provided, the tile renders with those instead of placeholder.
   *  Strips that don't pre-enrich (lazy-load mode) just omit this. */
  scraped?: Pick<ScrapedPost, 'cover' | 'author'> | null;
}

/** WP post → FeedItem for a tile. `id` is the post slug (URL-safe,
 *  stable, what `/audiobooks/:id` resolves to) — not the numeric WP
 *  post ID, because the slug is what the existing /podcasts /radios
 *  routes' `:slug` shape uses. */
export function mapPostToFeedItem(post: WpPost, opts: MapPostOptions = {}) {
  const slug = slugFromLink(post.link);
  const enriched = opts.scraped ?? null;
  const cover = enriched?.cover ?? null;
  const author = enriched?.author ?? null;
  return {
    id: slug,
    title: decodeHtml(post.title.rendered),
    subtitle: author,
    type: 'audiobook' as const,
    image: cover ? [{ quality: '500x500', link: cover }] : [],
    source: SOURCE,
    // Extras ride through FeedItem.fromJson — useful for the detail
    // screen so it doesn't have to re-fetch metadata it already has.
    link: post.link,
    wpPostId: post.id,
    categories: post.categories ?? [],
    date: post.date,
  };
}

/** `cozy_search` hit → FeedItem. Already has cover + author inline, so
 *  no enrichment cost on search results. */
export function mapSearchHitToFeedItem(hit: CozySearchHit) {
  const slug = slugFromLink(hit.url);
  return {
    id: slug,
    title: decodeHtml(hit.title),
    subtitle: hit.author || null,
    type: 'audiobook' as const,
    image: hit.cover ? [{ quality: '500x500', link: hit.cover }] : [],
    source: SOURCE,
    link: hit.url,
  };
}

/** Scraped chapter → playable FeedItem. `type: 'song'` so the existing
 *  queue / player UI handles it natively. */
export function mapChapterToFeedItem(opts: {
  bookId: string;
  bookTitle: string;
  author: string | null;
  cover: string | null;
  chapter: ScrapedChapter;
}) {
  const { bookId, bookTitle, author, cover, chapter } = opts;
  return {
    id: `${bookId}-ch${chapter.number}`,
    title: chapter.title || `Chapter ${chapter.number}`,
    subtitle: author,
    type: 'song' as const,
    image: cover ? [{ quality: '500x500', link: cover }] : [],
    artists: author ? [{ id: author, name: author }] : [],
    album: bookTitle,
    source: SOURCE,
    // Free-form per the source ("12:34", "1:02:33"). Flutter shows
    // this string as-is on the chapter list; the player gets actual
    // position from mpv.
    duration: chapter.duration,
    // Tier-1 inline media — stream resolver short-circuits when this
    // is present, no per-play resolve needed.
    mediaUrls: [{ quality: 'audiobook', link: chapter.mediaUrl }],
  };
}
