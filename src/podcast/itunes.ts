// Apple Podcasts → curated chart source for the /podcasts/home aggregator.
//
// Why this exists: PodcastIndex's /podcasts/trending is feed-activity-driven
// (whichever podcasts pushed an episode recently) — so it surfaces a lot of
// thin SEO-style noise. Apple's charts are editorial + listening-data driven
// per country storefront, which is what users actually expect from a "Top
// Podcasts in <country>" surface.
//
// Apple gives us iTunes IDs only. The actual PodcastIndex show / episodes
// are still resolved through /podcasts/byitunesid (one call per id) so the
// rest of the pipeline — episode playback, search, subscriptions — is
// unchanged. This module is therefore a *discovery* layer; PodcastIndex
// stays the runtime source of truth.
//
// Endpoint:
//   https://itunes.apple.com/{cc}/rss/toppodcasts/limit={N}[/genre={id}]/json
//
// One unified RSS-JSON endpoint handles both the overall top-chart and
// per-genre top-charts (with `/genre={id}`). Public, unauth, free, no
// signup. Tolerates limits up to 200 but returns ~100 max in practice.
// (The newer rss.applemarketingtools.com endpoint started returning 405
// in 2026 — kept this RSS one as the only path.)

import { cache } from '../redis';

const APPLE_USER_AGENT = 'sunoh-api/1.0 (+https://sunoh.online)';

export interface AppleChartEntry {
  /** iTunes podcast id — what PodcastIndex's /podcasts/byitunesid wants. */
  itunesId: string;
  name: string;
  artistName?: string;
  artworkUrl?: string;
}

interface AppleRssEntry {
  id?: { label?: string; attributes?: { 'im:id'?: string } };
  'im:name'?: { label?: string };
  'im:artist'?: { label?: string };
  'im:image'?: Array<{ label?: string; attributes?: { height?: string } }>;
}
interface AppleRssBody {
  feed?: { entry?: AppleRssEntry[] };
}

async function fetchAppleChart(
  country: string,
  count: number,
  genreId: string | undefined,
): Promise<AppleChartEntry[]> {
  const cc = country.toLowerCase();
  const n = Math.min(Math.max(count, 1), 100);
  const path = genreId
    ? `${encodeURIComponent(cc)}/rss/toppodcasts/limit=${n}/genre=${encodeURIComponent(genreId)}/json`
    : `${encodeURIComponent(cc)}/rss/toppodcasts/limit=${n}/json`;
  const url = `https://itunes.apple.com/${path}`;
  const cacheKey = `apple_chart_v1_${cc}_${genreId ?? 'top'}_${n}`;

  try {
    const cached = (await cache.get(cacheKey)) as AppleChartEntry[] | null;
    if (cached) return cached;
  } catch {
    /* cache offline — go live */
  }

  let body: AppleRssBody | null = null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': APPLE_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    body = (await res.json()) as AppleRssBody;
  } catch {
    return [];
  }

  const entries = body?.feed?.entry;
  if (!Array.isArray(entries)) return [];

  const out = entries
    .map<AppleChartEntry | null>((e) => {
      const itunesId = e?.id?.attributes?.['im:id'];
      if (!itunesId) return null;
      // Apple ships three image sizes (55, 60, 170). Take the largest as a
      // PodcastIndex-art fallback for the rare case where the resolved
      // PodcastIndex feed is missing artwork.
      const images = e['im:image'] ?? [];
      const largest = images
        .filter((i) => i && i.label)
        .sort(
          (a, b) =>
            parseInt(b.attributes?.height ?? '0', 10) - parseInt(a.attributes?.height ?? '0', 10),
        )[0];
      return {
        itunesId: String(itunesId),
        name: e['im:name']?.label ?? '',
        artistName: e['im:artist']?.label,
        artworkUrl: largest?.label,
      };
    })
    .filter((x): x is AppleChartEntry => x !== null);

  try {
    await cache.set(cacheKey, out, 60 * 60 * 24);
  } catch {
    /* cache write blip — return the live result anyway */
  }
  return out;
}

/**
 * Apple's "Top Podcasts" overall chart for the given storefront.
 * 24 h Redis TTL — Apple updates these charts at most daily.
 */
export function appleTopOverall(country: string, count = 25): Promise<AppleChartEntry[]> {
  return fetchAppleChart(country, count, undefined);
}

/**
 * Apple's top chart filtered to a single iTunes Podcast genre.
 *
 * Genre IDs (iTunes Podcast taxonomy):
 *   1303 Comedy · 1304 Education · 1310 Music · 1311 News
 *   1314 Religion & Spirituality · 1315 Science · 1316 Sports
 *   1318 Technology · 1321 Business · 1324 Society & Culture
 *   1480 Arts · 1488 History · 1489 Fiction · 1545 True Crime
 */
export function appleTopByGenre(
  country: string,
  genreId: string,
  count = 25,
): Promise<AppleChartEntry[]> {
  return fetchAppleChart(country, count, genreId);
}
