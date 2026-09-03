/**
 * Canonical track shape used by the matcher.
 *
 * Every catalogue the app touches (Saavn, Gaana, and the Tidal-backed lossless
 * catalogue) is normalized into this before any scoring happens, so the scorer
 * never has to know where a track came from.
 */

export type CatalogSource =
  | 'saavn'
  | 'gaana'
  | 'tidal'
  | 'qobuz'
  | 'amazon'
  | 'deezer'
  | 'musicbrainz'
  | 'spotify'
  | 'itunes'
  | 'manual';

export interface CanonicalTrack {
  source: CatalogSource;
  /** Identifier within `source`. */
  sourceId?: string;
  /** Title with any parenthetical version marker stripped into `version`. */
  title: string;
  /** Title exactly as the source gave it. */
  rawTitle?: string;
  /** "Remix", "Live", "Acoustic"... only set for genuinely different recordings. */
  version?: string;
  /** Performing artists, normalized for matching. */
  artists: string[];
  /**
   * Artist names with original casing and punctuation.
   *
   * `artists` is lowercased and depunctuated because that is what matching
   * needs; it must never reach a tag or a filename. Anything written into a
   * file uses these instead.
   */
  artistNames?: string[];
  album?: string;
  albumId?: string;
  year?: number;
  durationSec?: number;
  isrc?: string;
  /**
   * True when the ISRC was inferred by a bridge rather than published by the
   * source. An inferred ISRC is a hint, not an identity.
   */
  isrcInferred?: boolean;
  language?: string;
  label?: string;
  coverUrl?: string;
  explicit?: boolean;
  trackNumber?: number;
  discNumber?: number;
  /** Popularity, used only to break otherwise-equal ties. */
  popularity?: number;
  /** True when the catalogue advertises a hi-res tier. */
  hires?: boolean;
  /** e.g. "HIRES_LOSSLESS", "LOSSLESS". */
  quality?: string;
  bitDepth?: number;
  samplingRateHz?: number;
}

/** Engines that can actually produce a lossless file. */
export type EngineName = 'qobuz' | 'tidal' | 'amazon' | 'deezer';

/** Download priority order, matching the original Python cascade. */
export const ENGINE_ORDER: readonly EngineName[] = ['qobuz', 'tidal', 'amazon', 'deezer'] as const;

export interface EngineSearchResult extends CanonicalTrack {
  source: 'qobuz' | 'tidal' | 'amazon' | 'deezer';
  sourceId: string;
}

/** Per-axis breakdown, so a rejected match can explain itself. */
export interface MatchBreakdown {
  isrc: number;
  title: number;
  artist: number;
  album: number;
  duration: number;
  year: number;
  version: number;
  penalty: number;
}

export interface MatchResult {
  candidate: CanonicalTrack;
  /** 0..100. */
  score: number;
  /** True when both sides carried the same ISRC. */
  exact: boolean;
  breakdown: MatchBreakdown;
  reasons: string[];
}

export interface MatchOptions {
  /** Reject anything scoring below this. Default 62. */
  threshold?: number;
  /** Seconds of duration drift still treated as a perfect match. Default 3. */
  durationToleranceSec?: number;
  /** Resolve an ISRC before searching when the source has none. Default true. */
  enrichIsrc?: boolean;
  /** Treat a version mismatch as disqualifying rather than penalised. Default true. */
  strictVersion?: boolean;
  signal?: AbortSignal;
}

/** What the /match endpoints return. */
export interface LosslessMatch {
  /** Echo of what was matched, after normalization. */
  target: CanonicalTrack;
  isrc?: string;
  isrcSource?: CatalogSource;
  /** Null when nothing cleared the threshold. */
  lossless: (CanonicalTrack & { score: number; exact: boolean }) | null;
  /** Why the match was accepted or refused. */
  reasons: string[];
  elapsedMs: number;
}
