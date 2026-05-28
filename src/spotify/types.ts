// Shared types for the Spotify-import pipeline. Lives separately so
// `scraper.ts` and `match.ts` don't import each other and keep their
// concerns clean (scrape vs match).

export interface SpotifyTrack {
  /** Spotify track id (the base-62 segment after `/track/`). */
  id: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  /** Album release year (`YYYY`), when extractable. Scraper currently
   *  doesn't pull it; reserved for any future enrichment path. */
  year?: string;
  /** International Standard Recording Code. Never populated by the
   *  scraper (Spotify's DOM doesn't expose `external_ids`) — kept on
   *  the type so the matcher can opportunistically use it if a future
   *  enrichment step lands one. */
  isrc?: string;
  explicit?: boolean;
  /** Direct Spotify URL — useful for the UI to link back to the source. */
  url?: string;
  /** Album-art URL (largest available). */
  artworkUrl?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  followers?: number;
  artworkUrl?: string;
  url?: string;
  tracks: SpotifyTrack[];
  trackCount: number;
}
