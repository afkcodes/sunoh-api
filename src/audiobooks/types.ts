// WordPress + Cozy-specific shapes from cozyaudiobooks.com.
//
// The source is a stock WordPress site (`wp-json/wp/v2/...`) plus a
// custom `cozy_search` AJAX handler. We don't try to model the full
// WP envelope — just the fields we actually consume in mappers.ts
// + scraper.ts.

/** One row from `GET /wp-json/wp/v2/posts`. WP gives lots more fields
 *  but we only care about these. */
export interface WpPost {
  id: number;
  /** ISO 8601 — used for "Latest" ordering. */
  date: string;
  /** `cozyaudiobooks.com/<slug>/` — the post page we scrape for the
   *  audio src + chapter list + cover. */
  link: string;
  /** Rendered HTML — usually has &amp; entities; mappers decode. */
  title: { rendered: string };
  /** Category IDs the post belongs to. Used for the "Mystery" /
   *  "Fantasy" / etc. genre strips. */
  categories: number[];
}

/** One row from `GET /wp-json/wp/v2/categories`. */
export interface WpCategory {
  id: number;
  /** Display label (entity-decoded for the client). */
  name: string;
  /** URL-safe slug. */
  slug: string;
  /** Number of posts in this category. Drives the "browse genres"
   *  sort order. */
  count: number;
}

/** One row from the custom `admin-ajax.php?action=cozy_search` handler.
 *  Returns instant results with cover + author already inlined — no
 *  per-post scrape needed for search. */
export interface CozySearchHit {
  title: string;
  author: string;
  /** Same `cozyaudiobooks.com/<slug>/` shape as `WpPost.link`. */
  url: string;
  /** Amazon `m.media-amazon.com` CDN URL most of the time. */
  cover: string;
}

/** A single chapter parsed out of `<ol id="chapterList">`. */
export interface ScrapedChapter {
  /** 1-based per the broadcast — matches the `<span class="ch-num">`. */
  number: number;
  title: string;
  /** Free-form — "12:34", "1:02:33", "ad break". Server passes through;
   *  Flutter renders it as-is. */
  duration: string;
  /** MP3 (usually) hosted on `ipaudio7.com` / `fullaudiobooks.com`. */
  mediaUrl: string;
}

/** Everything we extract from a single post's HTML — covers, author,
 *  audio + chapter list. Result of one `enrichPost(link)` call. */
export interface ScrapedPost {
  /** og:image → Amazon CDN cover, mostly. */
  cover: string | null;
  author: string | null;
  /** Standalone full-book audio (the `<audio id="mainPlayer">` src). */
  audioUrl: string | null;
  chapters: ScrapedChapter[];
}
