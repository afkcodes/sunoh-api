// Spotify playlist scraper — headless-Chrome + scroll DOM extraction.
//
// Spotify's Web API requires a Premium subscription on the dev account
// (as of 2024) so we can't use the official /v1/playlists/{id} endpoint.
// Their embed page works without auth but hard-caps at 100 tracks per
// playlist, which truncates large user playlists. This scraper navigates
// the real web UI in headless Chrome, scrolls the virtualised tracklist
// container, and harvests rendered rows — handling up to ~1000 tracks.
//
// Previous incarnation (`spotify_import/spotify_playlist.ts`) was a 569-
// line single function with the same track-extraction code copy-pasted
// three times, ~12 magic numbers inline, and a debug-diagnostics block
// mixed with the real flow. This version preserves the load-bearing
// scraping logic (anti-detection setup, selector fallbacks, progressive
// scroll amounts, stable-bottom detection) but factored into named
// helpers + constants.

import puppeteer, { type Browser, type Page } from 'puppeteer';

import { cache } from '../redis';
import type { SpotifyPlaylist, SpotifyTrack } from './types';

// ── Knobs ────────────────────────────────────────────────────────────────
// Surface every magic number from the old implementation up here with
// the reasoning attached, so future tuning is "edit the constant" rather
// than "spelunk the loop".

const NAV_TIMEOUT_MS = 30_000;
const CONTENT_SELECTOR_TIMEOUT_MS = 8_000;
/** Hard ceiling on scroll iterations. Spotify's virtualised list shows
 *  ~10 rows per viewport; 100 × 10 ≈ 1000 tracks, our practical cap. */
const MAX_SCROLL_ATTEMPTS = 100;
/** Bail after this many scrolls in a row with zero new tracks. Empirical
 *  — Spotify sometimes pauses lazy-loading; 5 covers the worst stalls
 *  without false-positive bailing mid-list. */
const MAX_NO_NEW_TRACKS = 5;
/** Initial scroll step. Decreases as we go deeper to catch tracks the
 *  virtualised renderer might unmount before we extract them. */
const SCROLL_STEP_INITIAL = 400;
const SCROLL_STEP_DEEP = 200;
const SCROLL_STEP_DEEPER = 150;
const WAIT_AFTER_SCROLL_MS = 1_500;
const FINAL_BOTTOM_SETTLE_MS = 2_000;

const VIEWPORT_SELECTOR = '.main-view-container [data-overlayscrollbars-viewport]';
const ROW_SELECTOR = '[data-testid="tracklist-row"]';

const PLAYLIST_CACHE_KEY = (id: string) => `spotify_playlist_v1_${id}`;
const PLAYLIST_TTL_SEC = 60 * 10; // 10 min — repeated tries on the same URL go free.

// ── Public surface ───────────────────────────────────────────────────────

/**
 * Pull any Spotify playlist input down to a bare 22-char id.
 * Accepts: web URLs (with or without ?si=…), `spotify:playlist:` URIs,
 * or a raw id.
 */
export function extractPlaylistId(input: string | undefined | null): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  const urlMatch = s.match(/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = s.match(/^spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  if (/^[a-zA-Z0-9]{16,40}$/.test(s)) return s;
  return null;
}

export interface ScrapeOptions {
  /** Set false to see the browser window (dev only). Always true in prod. */
  headless?: boolean;
  /** Verbose logging through console.error. */
  debug?: boolean;
}

/**
 * Scrape a Spotify playlist by id. Returns null when the page can't be
 * loaded (e.g. private, removed, region-blocked). 10-min Redis cache so
 * repeated tries on the same URL don't re-launch Chrome each time.
 */
export async function fetchSpotifyPlaylist(
  playlistId: string,
  opts: ScrapeOptions = {},
): Promise<SpotifyPlaylist | null> {
  const cacheKey = PLAYLIST_CACHE_KEY(playlistId);
  try {
    const cached = (await cache.get(cacheKey)) as SpotifyPlaylist | null;
    if (cached) return cached;
  } catch {
    /* cache offline — go live */
  }

  const url = `https://open.spotify.com/playlist/${playlistId}`;
  const debug = !!opts.debug;
  const browser = await launchBrowser(opts.headless ?? true);
  try {
    const page = await browser.newPage();
    await applyAntiDetection(page);
    await navigateToPlaylist(page, url, debug);
    const meta = await extractPlaylistMeta(page);
    const tracks = await scrapeAllTracks(page, debug);

    const out: SpotifyPlaylist = {
      id: playlistId,
      name: meta.name,
      description: meta.description,
      owner: meta.owner,
      artworkUrl: meta.artworkUrl,
      url,
      tracks,
      trackCount: tracks.length,
    };

    try {
      await cache.set(cacheKey, out, PLAYLIST_TTL_SEC);
    } catch {
      /* cache write blip — return anyway */
    }
    return out;
  } catch (e) {
    if (debug) console.error('[spotify-scrape] error:', (e as Error).message);
    return null;
  } finally {
    await browser.close();
  }
}

// ── Internals ────────────────────────────────────────────────────────────

async function launchBrowser(headless: boolean): Promise<Browser> {
  return puppeteer.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
}

/** Apply the standard headless-Chrome telltale removals. Spotify checks
 *  several of these and short-circuits the playlist render if it
 *  detects automation. */
async function applyAntiDetection(page: Page): Promise<void> {
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  // Tall viewport so more rows render at once (Spotify's list is
  // virtualised — bigger viewport = bigger window of rows). 3000 px is
  // a sweet spot from the old impl; smaller missed mid-list rows.
  await page.setViewport({ width: 1366, height: 3000 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    (window as any).chrome = { runtime: {} };
    delete (navigator as any).__proto__.webdriver;
  });
}

async function navigateToPlaylist(page: Page, url: string, debug: boolean): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  if (debug) console.error('[spotify-scrape] page loaded, waiting for tracklist…');
  // Spotify ships the same content under different test ids over time —
  // wait for ANY of these to land. Plain "h1 exists" check is the
  // bottom-of-the-barrel signal.
  try {
    await Promise.race([
      page.waitForSelector('[data-testid="playlist-page"]', {
        timeout: CONTENT_SELECTOR_TIMEOUT_MS,
      }),
      page.waitForSelector('h1[data-testid="entityTitle"]', {
        timeout: CONTENT_SELECTOR_TIMEOUT_MS,
      }),
      page.waitForSelector('.main-view-container', { timeout: CONTENT_SELECTOR_TIMEOUT_MS }),
    ]);
  } catch {
    await sleep(2_000);
    const hasContent = await page.evaluate(
      () => !!document.querySelector('h1, [role="main"], .main-view-container'),
    );
    if (!hasContent) {
      throw new Error(
        'Playlist content not found — Spotify may have blocked the request or changed their UI.',
      );
    }
  }
}

interface PlaylistMeta {
  name: string;
  description?: string;
  owner?: string;
  artworkUrl?: string;
}

async function extractPlaylistMeta(page: Page): Promise<PlaylistMeta> {
  return page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel);
    const text = (el: Element | null) => el?.textContent?.trim() || '';
    // Title — try the canonical entityTitle, then nearby fallbacks.
    const name =
      text(q('h1[data-testid="entityTitle"]')) ||
      text(q('.topbar-content-wrapper h1')) ||
      text(q('[data-testid="playlist-page"] h1')) ||
      text(q('main h1')) ||
      text(q('h1')) ||
      'Unknown Playlist';
    const description = text(q('[data-testid="description"]')) || undefined;
    // Owner — usually a link near the title; conservative selector.
    const owner =
      text(q('[data-testid="creator-link"]')) ||
      text(q('a[data-testid="creator-link"]')) ||
      undefined;
    // Largest <img> on the page that's positioned in the header area —
    // good enough proxy for the cover. The page also has favicons and
    // small avatars, so we pick by min-size.
    let artworkUrl: string | undefined;
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      const w = (img as HTMLImageElement).naturalWidth;
      if (w >= 200 && (img as HTMLImageElement).src) {
        artworkUrl = (img as HTMLImageElement).src;
        break;
      }
    }
    return { name, description, owner, artworkUrl };
  });
}

/**
 * Scroll the virtualised tracklist container, extracting tracks as they
 * render. Termination is *only* "MAX_NO_NEW_TRACKS scrolls in a row
 * with zero new ids" (plus the 1000-track soft cap and the hard
 * attempt ceiling).
 *
 * Why not also detect "at bottom" via scrollHeight? Spotify's container
 * is virtualised — `scrollHeight` reports the FULL list size up front
 * regardless of which rows are mounted, so "scrollHeight stopped
 * growing" fires from iteration 2 onward and would bail mid-list. The
 * "no new tracks" signal is the only reliable one.
 *
 * After termination, one final "scroll to absolute bottom + wait" and
 * re-extract to catch the last few rows the virtualised renderer might
 * have unmounted between scrolls.
 */
async function scrapeAllTracks(page: Page, debug: boolean): Promise<SpotifyTrack[]> {
  // Make sure we start at the top — sometimes the page restores a prior
  // scroll position which would skip the first batch.
  await page.evaluate((sel) => {
    const v = document.querySelector(sel) as HTMLElement | null;
    if (v) v.scrollTop = 0;
  }, VIEWPORT_SELECTOR);
  await sleep(1_000);

  const collected = new Map<string, SpotifyTrack>();
  let noNewCount = 0;

  for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
    const visible = await getVisibleTracks(page);
    let newThisRound = 0;
    for (const t of visible) {
      if (!collected.has(t.id)) {
        collected.set(t.id, t);
        newThisRound++;
      }
    }
    if (debug) {
      console.error(
        `[spotify-scrape] scroll ${attempt}: visible=${visible.length} new=${newThisRound} total=${collected.size}`,
      );
    }

    noNewCount = newThisRound === 0 ? noNewCount + 1 : 0;
    if (noNewCount >= MAX_NO_NEW_TRACKS) {
      if (debug) console.error('[spotify-scrape] no new tracks for a while — finishing up');
      break;
    }
    if (collected.size >= 1000) {
      if (debug) console.error('[spotify-scrape] hit 1000-track soft cap — stopping');
      break;
    }

    await scrollViewportStep(page, attempt);
    await sleep(WAIT_AFTER_SCROLL_MS);
  }

  // One final settle-and-extract — virtualised renderers sometimes
  // unmount the very-last rows between scrolls, so a tail catch-up pass
  // recovers them.
  await page.evaluate((sel) => {
    const v = document.querySelector(sel) as HTMLElement | null;
    if (v) v.scrollTop = v.scrollHeight;
  }, VIEWPORT_SELECTOR);
  await sleep(FINAL_BOTTOM_SETTLE_MS);
  const tail = await getVisibleTracks(page);
  let tailAdded = 0;
  for (const t of tail) {
    if (!collected.has(t.id)) {
      collected.set(t.id, t);
      tailAdded++;
    }
  }
  if (debug && tailAdded > 0) {
    console.error(`[spotify-scrape] tail pass added ${tailAdded} tracks`);
  }

  return Array.from(collected.values());
}

/** Extract every currently-rendered track row to plain JS objects. */
async function getVisibleTracks(page: Page): Promise<SpotifyTrack[]> {
  return page.evaluate((rowSelector) => {
    const rows = document.querySelectorAll(rowSelector);
    const out: any[] = [];
    const timeRe = /^\d+:\d{2}$/;

    rows.forEach((row) => {
      try {
        const nameEl = row.querySelector('[data-testid="internal-track-link"]');
        const name = nameEl?.textContent?.trim();
        if (!name) return;

        const artistEls = row.querySelectorAll('a[href*="/artist/"]');
        const artists = Array.from(artistEls, (el) => el.textContent?.trim() || '').filter(Boolean);
        if (artists.length === 0) return;

        const album = row.querySelector('a[href*="/album/"]')?.textContent?.trim() || '';

        // Duration — testid first, then any text node matching M:SS.
        let durationText = row.querySelector('[data-testid="duration"]')?.textContent?.trim() || '';
        if (!durationText) {
          const all = row.querySelectorAll('*');
          for (const el of Array.from(all)) {
            const t = el.textContent?.trim();
            if (t && timeRe.test(t) && !el.querySelector('*')) {
              durationText = t;
              break;
            }
          }
        }
        let durationMs = 0;
        if (timeRe.test(durationText)) {
          const [m, s] = durationText.split(':').map(Number);
          durationMs = (m * 60 + s) * 1000;
        }

        const trackLink = nameEl?.getAttribute('href') || '';
        const id = trackLink.split('/track/')[1]?.split('?')[0] || '';
        if (!id) return;

        out.push({
          id,
          name,
          artists,
          album,
          durationMs,
          url: `https://open.spotify.com${trackLink}`,
        });
      } catch {
        /* per-row extraction errors — skip the row */
      }
    });

    return out;
  }, ROW_SELECTOR);
}

/** Step the virtualised viewport down by SCROLL_STEP_* (smaller as
 *  attempts grow — catches more rows the virtualiser unmounts behind
 *  us as we go deeper). */
async function scrollViewportStep(page: Page, attempt: number): Promise<void> {
  await page.evaluate(
    ({ sel, attempt, INITIAL, DEEP, DEEPER }) => {
      const v = document.querySelector(sel) as HTMLElement | null;
      if (!v) return;
      let amount = INITIAL;
      if (attempt > 40) amount = DEEP;
      if (attempt > 60) amount = DEEPER;
      v.scrollBy(0, amount);
    },
    {
      sel: VIEWPORT_SELECTOR,
      attempt,
      INITIAL: SCROLL_STEP_INITIAL,
      DEEP: SCROLL_STEP_DEEP,
      DEEPER: SCROLL_STEP_DEEPER,
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
