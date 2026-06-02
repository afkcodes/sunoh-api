// Radio (live internet stations) endpoints.
//
// Thin Fastify controllers in front of the sunoh-radio service. Map the
// upstream Station rows to the unified FeedItem-style shape the Flutter
// client already consumes for every other catalog and cache aggressively
// (Redis) so home / facets are essentially free at steady state.

import type { FastifyReply, FastifyRequest } from 'fastify';

import { cache } from '../redis';
import type { HomeSection } from '../types';
import { sendError, sendSuccess } from '../utils/response';
import { sunohRadioFetch } from './client';
import { mapRadioStation, mapRadioStations } from './mappers';
import { getResult, pendingResult, touchHot } from './now-playing-store';
import type { RadioFacet, RadioStationsPage, RadioStationUpstream } from './types';

const SOURCE = 'sunoh-radio';

// ── Country-aware home aggregator ────────────────────────────────────────
//
// Per-country: a "Top in {country}" hero row + per-genre rows that have
// enough representation locally. Same shape (HomeSection[]) as
// /podcasts/home so the Flutter renderer reuses the same UI.

interface RadioSectionConfig {
  heading: string;
  /** Pass to upstream as `genre=…`. Undefined → no filter (country-only). */
  genre?: string;
}

const COUNTRY_CONFIG: Record<string, { label: string; sections: RadioSectionConfig[] }> = {
  IN: {
    label: 'India',
    sections: [
      { heading: 'Top stations in India' },
      { heading: 'Bollywood', genre: 'bollywood' },
      { heading: 'Tamil', genre: 'tamil' },
      { heading: 'Indian', genre: 'indian' },
      { heading: 'News', genre: 'news' },
      { heading: 'Talk', genre: 'talk' },
    ],
  },
  US: {
    label: 'US',
    sections: [
      { heading: 'Top stations' },
      { heading: 'Pop', genre: 'pop' },
      { heading: 'Rock', genre: 'rock' },
      { heading: 'Country', genre: 'country' },
      { heading: 'Hip-Hop', genre: 'hip-hop' },
      { heading: 'News', genre: 'news' },
      { heading: 'Talk', genre: 'talk' },
    ],
  },
};
const DEFAULT_COUNTRY = 'IN';
const PER_SECTION_CAP = 12;

/**
 * Best-effort country resolution mirroring the /podcasts/home path:
 *   ?country → CF-IPCountry → Accept-Language → DEFAULT_COUNTRY.
 *
 * Kept narrower than the podcasts version (no IP-geo fallback) because
 * the radio API is smaller in scope — the cheap signals are good enough
 * and the Flutter app already passes `?country=…` from the device locale
 * on every call.
 */
function resolveCountry(req: FastifyRequest, explicit?: string): string {
  const upper = (v: string | undefined): string | undefined =>
    v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : undefined;
  const q = upper(explicit);
  if (q && COUNTRY_CONFIG[q]) return q;
  const cf = upper(req.headers['cf-ipcountry'] as string | undefined);
  if (cf && cf !== 'XX' && COUNTRY_CONFIG[cf]) return cf;
  const accept = (req.headers['accept-language'] as string | undefined) || '';
  const m = accept.split(',')[0]?.match(/-([A-Z]{2})/i);
  const al = upper(m?.[1]);
  if (al && COUNTRY_CONFIG[al]) return al;
  return DEFAULT_COUNTRY;
}

/**
 * GET /radios/home?country=IN
 *
 * Aggregated home — multi-section feed with a "Top in {country}" hero
 * row + per-genre rows that have local representation. Cached 1 h per
 * country code; the upstream catalog only grows on the order of hours
 * anyway (validation cron + scraper run on a slow loop).
 */
export const radiosHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { country?: string };
  const country = resolveCountry(req, q.country);
  const cfg = COUNTRY_CONFIG[country] ?? COUNTRY_CONFIG[DEFAULT_COUNTRY];
  const cacheKey = `radios_home_v2_${country}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', SOURCE);
  } catch {
    /* cache offline — refetch */
  }

  const fetches = await Promise.allSettled(
    cfg.sections.map((s) =>
      sunohRadioFetch<RadioStationsPage>('/stations', {
        country,
        genre: s.genre,
        status: 'working',
        limit: PER_SECTION_CAP,
      }),
    ),
  );

  // Dedup across sections — "Top in IN" overlaps with "Bollywood" /
  // "Tamil" heavily, and we want each station to appear once in the
  // most-relevant section (declared earliest wins).
  const seen = new Set<string>();
  const sections: HomeSection[] = [];
  fetches.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value.ok || !r.value.data) return;
    const items = mapRadioStations(r.value.data.data);
    const filtered = items.filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
    if (filtered.length === 0) return;
    sections.push({
      heading: cfg.sections[i].heading,
      data: filtered as any,
      source: SOURCE,
    });
  });

  if (sections.length === 0) {
    return sendError(res, 'No sections returned from upstream', null, 502);
  }
  try {
    await cache.set(cacheKey, sections, 60 * 60);
  } catch {
    /* cache write blip — return anyway */
  }
  return sendSuccess(res, sections, `Radios home (${country})`, SOURCE);
};

// ── Listing / search ─────────────────────────────────────────────────────

/**
 * GET /radios/stations?country=&genre=&language=&q=&limit=&offset=&status=
 *
 * Direct passthrough to upstream `/stations` with the same filter knobs,
 * plus FeedItem mapping. Use for category screens + search.
 */
export const radiosStationsController = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as any;
  const params: Record<string, string | number | undefined> = {
    country: q.country,
    genre: q.genre,
    language: q.language,
    q: q.q,
    status: q.status ?? 'working',
    limit: q.limit ? Number(q.limit) : 50,
    offset: q.offset ? Number(q.offset) : 0,
  };
  const upstream = await sunohRadioFetch<RadioStationsPage>('/stations', params);
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Stations fetch failed', null, 502);
  }
  const items = mapRadioStations(upstream.data.data);
  return sendSuccess(
    res,
    {
      list: items,
      count: items.length,
      pagination: upstream.data.pagination,
    },
    'Radio stations',
    SOURCE,
  );
};

/**
 * GET /radios/search?q=…&country=&limit=&offset=
 * Convenience alias for /stations?q=… — keeps URL shape symmetric with
 * /podcasts/search and /music/search.
 */
export const radiosSearchController = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as any;
  if (!q.q || (typeof q.q === 'string' && q.q.trim().length === 0)) {
    return sendError(res, 'Missing required query: q', null, 400);
  }
  const params: Record<string, string | number | undefined> = {
    q: q.q,
    country: q.country,
    status: 'working',
    limit: q.limit ? Number(q.limit) : 30,
    offset: q.offset ? Number(q.offset) : 0,
  };
  const upstream = await sunohRadioFetch<RadioStationsPage>('/stations', params);
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Search failed', null, 502);
  }
  const items = mapRadioStations(upstream.data.data);
  return sendSuccess(
    res,
    { list: items, count: items.length, pagination: upstream.data.pagination },
    `Radio search "${q.q}"`,
    SOURCE,
  );
};

/**
 * GET /radios/:slug — single station detail.
 *
 * Cached 24 h per slug because station rows barely change (the
 * scrape/validate pipeline mostly touches stream_url and status — name
 * + image + countries + genres are effectively stable).
 */
export const radioStationController = async (req: FastifyRequest, res: FastifyReply) => {
  const { slug } = req.params as { slug?: string };
  if (!slug) return sendError(res, 'Missing path param `slug`', null, 400);
  const cacheKey = `radio_station_v1_${slug}`;
  try {
    const cached = (await cache.get(cacheKey)) as RadioStationUpstream | null;
    if (cached) {
      return sendSuccess(res, mapRadioStation(cached), 'OK (Cached)', SOURCE);
    }
  } catch {
    /* cache offline */
  }
  const upstream = await sunohRadioFetch<RadioStationUpstream>(
    `/stations/${encodeURIComponent(slug)}`,
  );
  if (!upstream.ok || !upstream.data) {
    return sendError(
      res,
      upstream.error || 'Station not found',
      null,
      upstream.status === 404 ? 404 : 502,
    );
  }
  try {
    await cache.set(cacheKey, upstream.data, 60 * 60 * 24);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, mapRadioStation(upstream.data), 'Radio station', SOURCE);
};

// ── Facets (countries / genres / languages / stats) ──────────────────────
//
// Pure proxy with a Redis cache layer in front (10 min — matches the
// upstream's `Cache-Control` so we never serve staler-than-the-source).

async function facetController(res: FastifyReply, path: string, cacheKey: string, label: string) {
  try {
    const cached = (await cache.get(cacheKey)) as RadioFacet[] | null;
    if (cached) return sendSuccess(res, cached, `${label} (Cached)`, SOURCE);
  } catch {
    /* cache offline */
  }
  const upstream = await sunohRadioFetch<RadioFacet[]>(path);
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || `${label} fetch failed`, null, 502);
  }
  try {
    await cache.set(cacheKey, upstream.data, 60 * 10);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, upstream.data, label, SOURCE);
}

export const radiosCountriesController = (_: FastifyRequest, res: FastifyReply) =>
  facetController(res, '/countries', 'radio_countries_v1', 'Radio countries');

export const radiosGenresController = (_: FastifyRequest, res: FastifyReply) =>
  facetController(res, '/genres', 'radio_genres_v1', 'Radio genres');

export const radiosLanguagesController = (_: FastifyRequest, res: FastifyReply) =>
  facetController(res, '/languages', 'radio_languages_v1', 'Radio languages');

export const radiosStatsController = async (_: FastifyRequest, res: FastifyReply) => {
  try {
    const cached = await cache.get('radio_stats_v1');
    if (cached) return sendSuccess(res, cached, 'Radio stats (Cached)', SOURCE);
  } catch {
    /* cache offline */
  }
  const upstream = await sunohRadioFetch('/stats');
  if (!upstream.ok || !upstream.data) {
    return sendError(res, upstream.error || 'Stats fetch failed', null, 502);
  }
  try {
    await cache.set('radio_stats_v1', upstream.data, 60 * 10);
  } catch {
    /* cache write blip */
  }
  return sendSuccess(res, upstream.data, 'Radio stats', SOURCE);
};

// ── Now-playing (listener-driven Shazam) ─────────────────────────────────
//
// Flutter polls this endpoint every ~5 s while a station is playing.
// Two things happen per call:
//   1. The slug is "touched" — added/refreshed in the `radio:hot` ZSET
//      with a 30 s expiry. That's the only signal the background worker
//      uses to decide what to fingerprint. When the user pauses, polls
//      stop, the slug ages out, the worker stops spending Shazam calls.
//   2. The worker's most recent stored result for the slug is returned.
//      If the worker hasn't processed this slug yet (first poll after
//      tapping play), we return a `status: 'pending'` shape so the
//      client knows to keep polling rather than treat null as "no
//      song info available, ever".
//
// Shape kept small + flat — the Flutter client reads it directly into a
// small `RadioNowPlaying` model. `track.image` is the Apple Music CDN
// art URL Shazam returns (high quality, 400×400) — UI swaps it in
// while the live track plays, falls back to the station logo on miss.
export const radioNowPlayingController = async (req: FastifyRequest, res: FastifyReply) => {
  const { slug } = req.params as { slug?: string };
  if (!slug) return sendError(res, 'Missing path param `slug`', null, 400);

  // Touch FIRST — even if we have no result yet, this kicks off the
  // worker for this slug. Fire-and-forget; never blocks the response.
  void touchHot(slug);

  const stored = await getResult(slug);
  if (!stored) {
    return sendSuccess(
      res,
      { status: 'pending', ...pendingResult() },
      'Now-playing pending',
      SOURCE,
    );
  }
  const status = stored.matched ? 'matched' : 'no_match';
  return sendSuccess(res, { status, ...stored }, 'Now-playing', SOURCE);
};
