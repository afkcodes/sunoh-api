export interface Image {
  quality: string;
  link: string;
}

export type Images = Image[];

export interface Artist {
  id: string;
  name: string;
  subtitle?: string;
  role?: string;
  image?: Images;
  followers?: string;
  type?: string;
  url?: string;
  bio?: string;
  songCount?: string;
  albumCount?: string;
}

export interface Song {
  id: string;
  songId?: string;
  token?: string;
  title: string;
  subtitle?: string;
  type: 'song';
  image: Images;
  language?: string;
  year?: string;
  duration?: string;
  playCount?: string;
  mediaUrls?: Images;
  artists: Artist[];
  album?: {
    id: string;
    name: string;
    url?: string;
  };
  hasLyrics?: boolean;
  lyrics?: string;
  copyright?: string;
  releaseDate?: string;
  source: string;
}

export interface Album {
  id: string;
  title: string;
  subtitle?: string;
  headerDesc?: string;
  description?: string;
  type: 'album';
  image: Images;
  language?: string;
  year?: string;
  songCount?: string;
  artists: Artist[];
  songs?: Song[];
  copyright?: string;
  releaseDate?: string;
  playCount?: string;
  source: string;
  url?: string;
}

export interface Playlist {
  id: string;
  title: string;
  subtitle?: string;
  type: 'playlist';
  image: Images;
  songCount?: string;
  followers?: string;
  description?: string;
  songs?: Song[];
  source: string;
  url?: string;
}

export interface Channel {
  id: string;
  title: string;
  subtitle?: string;
  type: 'channel' | 'radio_station';
  image: Images;
  language?: string;
  stationType?: string;
  source: string;
  url?: string;
}

export interface Occasion {
  id: string;
  title: string;
  subtitle?: string;
  type: 'occasion';
  image: Images;
  language?: string;
  source: string;
  url?: string;
}

// ── Podcasts ─────────────────────────────────────────────────────────────
// Wraps PodcastIndex.org `feed` (show) + `item` (episode) shapes into the
// unified type space the Flutter app already speaks. The Flutter side
// uses `FeedItem` with a `type` discriminator; mapping a show to
// `type: 'podcast'` and an episode to `type: 'episode'` lets the existing
// FeedItem.fromJson parse them with no new client-side code.

export interface PodcastShow {
  id: string;
  title: string;
  subtitle?: string; // typically the author
  description?: string;
  type: 'podcast';
  image: Images;
  language?: string;
  categories?: string[];
  source: 'podcastindex';
  url?: string;
  // PodcastIndex-specific: itunesId for cross-linking.
  itunesId?: number;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  subtitle?: string; // show title — fills the "artist" slot in player UI
  description?: string;
  type: 'episode';
  image: Images;
  duration?: number; // seconds
  source: 'podcastindex';
  url?: string;
  // The actual audio URL goes here so the Flutter stream resolver's
  // tier-1 (embedded mediaUrls) plays it without a `/song/:id` round
  // trip. PodcastIndex always returns ONE enclosureUrl per episode;
  // we expose it under quality 'default' to match the array shape
  // of music tracks.
  mediaUrls?: { quality: string; link: string }[];
  // Provenance / extras the player can show or use.
  feedId?: number;
  feedTitle?: string;
  feedImage?: string;
  datePublished?: number; // unix seconds
  episode?: number;
  season?: number;
  explicit?: boolean;
  chaptersUrl?: string;
  transcriptUrl?: string;
}

export interface HomeSection {
  heading: string;
  data: (Song | Album | Playlist | Artist | Channel | Occasion | PodcastShow | PodcastEpisode)[];
  source: string;
}

export type HomeData = HomeSection[];
