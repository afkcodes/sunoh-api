// HTML extraction for Cozy Audiobooks post pages.
//
// We don't pull a parser (cheerio etc.) — the page is a fixed-shape
// WordPress template and the elements we care about are easy to grep
// with focused regex. If/when the template changes, this is the file
// to re-tune (budget ~1 hr per breakage).
//
// Targets:
//   - og:image            → book cover (Amazon `m.media-amazon.com` CDN)
//   - "by" line / heading → author (best-effort; falls back to null)
//   - <audio id="mainPlayer" src="…"> → standalone full-book audio
//   - <ol id="chapterList">…<li data-src="…"> per row → chapter array
//
// All four are independent — a parse failure on one doesn't kill the
// others. The controller decides what to do with partial data.

import type { ScrapedChapter, ScrapedPost } from './types';

const COVER_RE = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i;
const AUDIO_RE = /<audio[^>]+id=["']mainPlayer["'][^>]+src=["']([^"']+)["']/i;
// Author lookup — order matters, first hit wins.
//
// Cozy WP posts carry TWO "author" signals: the WP site author (always
// "admin") and the actual book author. We need the book author. Three
// patterns, in order of reliability:
//
//   1. schema.org Person graph — `"author":{"@type":"Person","name":"X"`.
//      Yoast emits this inline as ld+json for the real book author.
//      Most reliable when present.
//   2. Body-text "by …" — falls through to a `by <Author>` capture from
//      the rendered post body. Lossier (also matches non-author "by"
//      uses) but useful when (1) is missing.
//   3. Explicit "Author: …" label.
//
// The WP `<meta name="author" content="admin">` is intentionally NOT
// checked — it's always "admin" and would shadow the real author. */
const AUTHOR_RES: RegExp[] = [
  /"author"\s*:\s*\{\s*"@type"\s*:\s*"Person"\s*,\s*"name"\s*:\s*"([^"]+)"/i,
  /\bby\s+([A-Z][a-zA-Z.\-'’]+(?:\s+[A-Z][a-zA-Z.\-'’]+){0,3})\b/,
  />\s*Author:\s*([^<\n]+?)(?:<|$)/i,
];
// Chapter row — captures data-src + number + title + duration. The
// `data-src` attribute is what the site's JS uses to swap the audio
// element's src on click, so it's the most stable anchor.
const CHAPTER_RE =
  /<li[^>]+data-src=["']([^"']+)["'][^>]*>[\s\S]*?<span\s+class=["']ch-num["']>(\d+)<\/span>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

export function parseChapters(html: string): ScrapedChapter[] {
  const chapters: ScrapedChapter[] = [];
  // RegExp with /g state — reset before iterating in case the same
  // pattern instance was used by a sibling caller (we declare it
  // module-level for V8 caching but lastIndex would leak otherwise).
  CHAPTER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHAPTER_RE.exec(html)) !== null) {
    chapters.push({
      mediaUrl: m[1],
      number: Number(m[2]),
      title: decodeEntities(m[3].trim()),
      duration: decodeEntities(m[4].trim()),
    });
  }
  return chapters;
}

export function parsePost(html: string): ScrapedPost {
  const coverMatch = COVER_RE.exec(html);
  const audioMatch = AUDIO_RE.exec(html);
  return {
    cover: coverMatch ? coverMatch[1] : null,
    author: firstMatch(html, AUTHOR_RES),
    audioUrl: audioMatch ? audioMatch[1] : null,
    chapters: parseChapters(html),
  };
}
