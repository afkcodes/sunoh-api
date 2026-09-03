import type { CanonicalTrack, MatchBreakdown, MatchResult, MatchOptions } from "./types";
import {
  extractVersion,
  jaccard,
  normalizeIsrc,
  normalizeText,
  similarity,
  tokens,
  versionsAgree,
} from "./text";

/**
 * Axis weights, summing to 100.
 *
 * Duration is weighted heavily on purpose. On the sample track it is the only
 * signal that separates the original (288s) from the remix (299s) -- title,
 * artist and album are identical across both.
 */
const W = {
  title: 34,
  artist: 26,
  duration: 22,
  album: 10,
  year: 5,
  version: 3,
} as const;

export const DEFAULT_THRESHOLD = 62;
export const DEFAULT_DURATION_TOLERANCE = 3;

/** Score how well `candidate` matches `target`. Symmetric-ish, 0..100. */
export function scoreMatch(
  target: CanonicalTrack,
  candidate: CanonicalTrack,
  options: MatchOptions = {},
): MatchResult {
  const tolerance = options.durationToleranceSec ?? DEFAULT_DURATION_TOLERANCE;
  const strictVersion = options.strictVersion ?? true;
  const reasons: string[] = [];

  const breakdown: MatchBreakdown = {
    isrc: 0, title: 0, artist: 0, album: 0, duration: 0, year: 0, version: 0, penalty: 0,
  };

  // ---- ISRC: when both sides have one, it decides the question outright. ----
  const tIsrc = normalizeIsrc(target.isrc);
  const cIsrc = normalizeIsrc(candidate.isrc);
  if (tIsrc && cIsrc) {
    if (tIsrc === cIsrc) {
      breakdown.isrc = 100;
      reasons.push(`ISRC exact match (${tIsrc})`);
      return { candidate, score: 100, exact: true, breakdown, reasons };
    }
    // One recording legitimately carries different ISRCs across regions and
    // distributors, which is common in Indian catalogue: observed on both
    // "Blinding Lights" and "Kabira" against the same Tidal recording.
    //
    // So a mismatch is only counted against a candidate when our own ISRC came
    // from the source itself. When it was inferred by a bridge, penalising the
    // disagreement would compound one inference with another, so the exact-match
    // bonus is simply withheld instead.
    if (target.isrcInferred) {
      reasons.push(`ISRC differs (${tIsrc} vs ${cIsrc}); ours was inferred, so not counted against`);
    } else {
      breakdown.penalty -= 15;
      reasons.push(`ISRC mismatch (${tIsrc} vs ${cIsrc})`);
    }
  }

  // ---- Title ----
  const tParts = extractVersion(target.rawTitle ?? target.title);
  const cParts = extractVersion(candidate.rawTitle ?? candidate.title);
  const titleSim = similarity(tParts.base || target.title, cParts.base || candidate.title);
  breakdown.title = titleSim * W.title;
  if (titleSim >= 0.95) reasons.push("title exact");
  else if (titleSim >= 0.75) reasons.push(`title close (${titleSim.toFixed(2)})`);
  else reasons.push(`title weak (${titleSim.toFixed(2)})`);

  // ---- Version: a remix is not the track you asked for. ----
  const tVersion = target.version ?? tParts.version;
  const cVersion = candidate.version ?? cParts.version;
  if (versionsAgree(tVersion, cVersion)) {
    breakdown.version = W.version;
  } else {
    reasons.push(`version mismatch (${tVersion ?? "original"} vs ${cVersion ?? "original"})`);
    if (strictVersion) {
      breakdown.penalty -= 100;
      return {
        candidate,
        score: 0,
        exact: false,
        breakdown,
        reasons,
      };
    }
    breakdown.penalty -= 20;
  }

  // ---- Artist: token overlap, plus credit for any one full name matching. ----
  const tArtists = target.artists.map(normalizeText).filter(Boolean);
  const cArtists = candidate.artists.map(normalizeText).filter(Boolean);
  if (tArtists.length && cArtists.length) {
    const overlap = jaccard(
      new Set(tArtists.flatMap((a) => [...tokens(a)])),
      new Set(cArtists.flatMap((a) => [...tokens(a)])),
    );
    const anyExact = tArtists.some((a) => cArtists.some((c) => c === a));
    const artistScore = Math.max(overlap, anyExact ? 0.85 : 0);
    breakdown.artist = artistScore * W.artist;
    if (anyExact) reasons.push("artist exact");
    else if (artistScore >= 0.5) reasons.push(`artist overlap (${artistScore.toFixed(2)})`);
    else reasons.push(`artist weak (${artistScore.toFixed(2)})`);
  } else {
    // Unknown rather than wrong: award the neutral midpoint.
    breakdown.artist = W.artist * 0.5;
    reasons.push("artist unknown");
  }

  // ---- Duration ----
  if (target.durationSec && candidate.durationSec) {
    const diff = Math.abs(target.durationSec - candidate.durationSec);
    let ratio: number;
    if (diff <= tolerance) { ratio = 1; reasons.push(`duration match (±${diff}s)`); }
    else if (diff <= 5) { ratio = 0.82; reasons.push(`duration near (±${diff}s)`); }
    else if (diff <= 10) { ratio = 0.55; reasons.push(`duration drift (±${diff}s)`); }
    else if (diff <= 20) { ratio = 0.18; reasons.push(`duration off (±${diff}s)`); }
    else { ratio = 0; breakdown.penalty -= 12; reasons.push(`duration wrong (±${diff}s)`); }
    breakdown.duration = ratio * W.duration;
  } else {
    breakdown.duration = W.duration * 0.5;
    reasons.push("duration unknown");
  }

  // ---- Album ----
  // A differing album is weak evidence, not counter-evidence: catalogues
  // routinely attach a track to compilations and playlists (JioSaavn lists
  // "Billie Jean" under a 2026 World Cup compilation). Scoring a mismatch at
  // zero would rank a correct match below an unknown one, so it is floored.
  const ALBUM_FLOOR = 0.35;
  if (target.album && candidate.album) {
    const albumSim = similarity(target.album, candidate.album);
    breakdown.album = Math.max(albumSim, ALBUM_FLOOR) * W.album;
    if (albumSim >= 0.8) reasons.push("album match");
  } else {
    breakdown.album = W.album * 0.5;
  }

  // ---- Year ----
  // Same reasoning as album: a reissue or compilation carries a later year for
  // the same recording, so a distant year is only mildly discouraging.
  if (target.year && candidate.year) {
    const diff = Math.abs(target.year - candidate.year);
    breakdown.year =
      diff === 0 ? W.year : diff <= 1 ? W.year * 0.7 : diff <= 3 ? W.year * 0.4 : W.year * 0.25;
  } else {
    breakdown.year = W.year * 0.5;
  }

  const raw =
    breakdown.title + breakdown.artist + breakdown.duration +
    breakdown.album + breakdown.year + breakdown.version + breakdown.penalty;

  const score = Math.max(0, Math.min(100, raw));
  return { candidate, score, exact: false, breakdown, reasons };
}

/** Score every candidate and return them best-first, above threshold only. */
export function rankCandidates(
  target: CanonicalTrack,
  candidates: readonly CanonicalTrack[],
  options: MatchOptions = {},
): MatchResult[] {
  // Duration is the axis that separates a track from its remix. Gaana's search
  // results omit it (its detail endpoint has it), and without it a wrong
  // version is much easier to accept, so the bar is raised rather than letting
  // the neutral score carry a weak match through.
  const base = options.threshold ?? DEFAULT_THRESHOLD;
  const threshold = target.durationSec ? base : base + 12;

  return candidates
    .map((c) => scoreMatch(target, c, options))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: prefer hi-res, then more popular.
      if (!!b.candidate.hires !== !!a.candidate.hires) return b.candidate.hires ? 1 : -1;
      return (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0);
    });
}

/** Best single match, or null when nothing cleared the threshold. */
export function bestMatch(
  target: CanonicalTrack,
  candidates: readonly CanonicalTrack[],
  options: MatchOptions = {},
): MatchResult | null {
  return rankCandidates(target, candidates, options)[0] ?? null;
}
