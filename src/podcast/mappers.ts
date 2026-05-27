// PodcastIndex → unified FeedItem mappers.
//
// PodcastIndex has TWO shapes that matter:
//   * Feed (a "show"): id, title, description, author, image, artwork,
//     language, categories{}, itunesId, url.
//   * Item (an episode within a feed): id, title, description,
//     enclosureUrl + enclosureType + duration, image, feedId, feedImage,
//     datePublished, episode, season, explicit, chaptersUrl,
//     transcriptUrl.
//
// Both collapse to the Flutter app's FeedItem schema by setting `type`
// to either 'podcast' (show) or 'episode'. The Flutter audio engine
// already accepts FeedItems of `type='episode'` (handler queues + auto-
// advances them; the resolver tier-1 picks up `mediaUrls` directly).

import type { Images, PodcastEpisode, PodcastShow } from '../types';

// PodcastIndex sometimes returns `0` / empty strings for missing fields.
// Normalise to undefined so the typed shape is honest about absence.
const opt = <T>(v: T | undefined | null | '' | 0): T | undefined =>
  v === undefined || v === null || v === '' || v === 0 ? undefined : (v as T);

/**
 * Build a 3-tier `Images` array from PodcastIndex's `image` (medium-ish)
 * and `artwork` (high-res) fields. PodcastIndex doesn't ship a 50x50
 * variant, so the smallest tier is the same URL — the Flutter art
 * loader's tier cache (192/384/720) will resize down for thumbnail
 * surfaces.
 *
 * Quality strings match the music-side convention (`500x500` etc.) so
 * `FeedItem.artwork`'s largest-resolution picker works unchanged.
 */
function buildImages(image?: string, artwork?: string): Images {
  const small = image || artwork;
  const large = artwork || image;
  if (!small && !large) return [];
  const out: Images = [];
  if (small) out.push({ quality: '150x150', link: small });
  if (large && large !== small) out.push({ quality: '500x500', link: large });
  // Keep at least one entry even if only one URL is known.
  if (out.length === 0 && small) {
    out.push({ quality: '500x500', link: small });
  }
  return out;
}

/**
 * PodcastIndex's `categories` is a numeric-keyed object (`{"55":"News",
 * "59":"Daily News"}`). Flatten to a plain string array.
 */
function flattenCategories(raw: any): string[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const names = Object.values(raw).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return names.length > 0 ? names : undefined;
}

/**
 * Map a PodcastIndex feed object → PodcastShow. Accepts the trending /
 * search / byfeedid response shape (same shape across endpoints).
 */
export function mapPodcastShow(feed: any): PodcastShow {
  return {
    id: String(feed.id ?? feed.feedId ?? ''),
    title: feed.title ?? feed.feedTitle ?? '',
    subtitle: opt<string>(feed.author),
    description: opt<string>(feed.description),
    type: 'podcast',
    image: buildImages(feed.image, feed.artwork),
    language: opt<string>(feed.language),
    categories: flattenCategories(feed.categories),
    source: 'podcastindex',
    url: opt<string>(feed.url ?? feed.link),
    itunesId: opt<number>(feed.itunesId),
  };
}

/**
 * Map a PodcastIndex item object → PodcastEpisode. The enclosure URL
 * lands in `mediaUrls` so the Flutter resolver doesn't need a second
 * round trip to fetch it.
 */
export function mapPodcastEpisode(item: any): PodcastEpisode {
  const enclosure = opt<string>(item.enclosureUrl);
  return {
    id: String(item.id ?? item.guid ?? ''),
    title: item.title ?? '',
    // The show title fills the "artist" slot in the Flutter player UI —
    // it's the most useful secondary line for an episode tile.
    subtitle: opt<string>(item.feedTitle),
    description: opt<string>(item.description),
    type: 'episode',
    image: buildImages(item.image, item.feedImage),
    duration: opt<number>(item.duration),
    source: 'podcastindex',
    url: opt<string>(item.link),
    mediaUrls: enclosure ? [{ quality: 'default', link: enclosure }] : undefined,
    feedId: opt<number>(item.feedId),
    feedTitle: opt<string>(item.feedTitle),
    feedImage: opt<string>(item.feedImage),
    datePublished: opt<number>(item.datePublished),
    episode: opt<number>(item.episode),
    season: opt<number>(item.season),
    explicit: item.explicit === 1 || item.explicit === true || undefined,
    chaptersUrl: opt<string>(item.chaptersUrl),
    transcriptUrl: opt<string>(item.transcriptUrl),
  };
}

export function mapPodcastShows(feeds: any[] | undefined | null): PodcastShow[] {
  if (!Array.isArray(feeds)) return [];
  return feeds.map(mapPodcastShow);
}

export function mapPodcastEpisodes(items: any[] | undefined | null): PodcastEpisode[] {
  if (!Array.isArray(items)) return [];
  return items.map(mapPodcastEpisode);
}
