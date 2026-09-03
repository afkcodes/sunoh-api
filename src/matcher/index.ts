/**
 * Lossless track matching.
 *
 * Given a Song from any of the app's providers (Saavn or Gaana, which share one
 * Song type), find the same recording in the lossless catalogue and report
 * whether a hi-res tier exists.
 *
 * The design principle throughout: refuse rather than guess. A remix, a live
 * cut or a cover-band recording scores zero, so a caller gets "not available"
 * instead of a confidently wrong track.
 */
export { matchCanonical, matchSong, matchSongs, resolveIsrc } from './match';
export { extractSongs, fromSong, type SongLike } from './normalize';
export { bestMatch, rankCandidates, scoreMatch } from './score';
export * as hifi from './providers/hifi';
export type { CanonicalTrack, LosslessMatch, MatchOptions, MatchResult } from './types';
