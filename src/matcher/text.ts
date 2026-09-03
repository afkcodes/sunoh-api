/**
 * Text normalization for catalog matching.
 *
 * The job here is to make "Subha Hone Na De" from JioSaavn comparable to
 * "Subha Hone Na De (From \"Desi Boyz\")" on iTunes, while still keeping it
 * distinguishable from "Subha Hone Na De (Remix)" -- which is a different
 * recording with a different ISRC and a 11-second longer runtime.
 */

/**
 * Parentheticals that mark a genuinely DIFFERENT recording. If the target and
 * candidate disagree on any of these, they are not the same audio.
 */
const DISQUALIFYING_VERSION = [
  "remix", "live", "acoustic", "instrumental", "karaoke", "cover", "unplugged",
  "demo", "reprise", "mashup", "medley", "sped up", "spedup", "slowed",
  "nightcore", "8d", "lo-fi", "lofi", "rework", "bootleg", "vip mix", "dub",
  "edit by", "mix by", "session", "rehearsal", "a cappella", "acapella",
];

/**
 * Parentheticals that are marketing noise around the SAME recording. Stripping
 * these is what lets a soundtrack listing match a single release.
 */
const NOISE_VERSION = [
  "original motion picture soundtrack", "motion picture soundtrack",
  "original soundtrack", "soundtrack", "ost", "from", "bonus track",
  "deluxe", "deluxe edition", "expanded", "remastered", "remaster",
  "album version", "single version", "explicit", "clean", "stereo", "mono",
  "digital", "hd", "hi-res", "anniversary edition", "special edition",
];

const FEATURING = /\s*[\(\[]?\s*\b(?:feat|ft|featuring|with)\b\.?\s+[^)\]]*[\)\]]?/gi;

/** Lowercase, strip diacritics, drop punctuation, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[&]/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize for comparison AND drop any "feat. X" clause. */
export function normalizeTitle(input: string | null | undefined): string {
  if (!input) return "";
  return normalizeText(String(input).replace(FEATURING, " "));
}

export interface TitleParts {
  /** Title with all bracketed segments and trailing "- Foo" removed. */
  base: string;
  /** Version keyword found, if the segment was a real version marker. */
  version?: string;
  /** Everything that was stripped, for debugging. */
  stripped: string[];
}

/**
 * Split a raw title into its base and any meaningful version marker.
 *
 *   'Subha Hone Na De (From "Desi Boyz")' -> base "Subha Hone Na De", no version
 *   'Subha Hone Na De (Remix)'            -> base "Subha Hone Na De", version "remix"
 */
export function extractVersion(rawTitle: string | null | undefined): TitleParts {
  if (!rawTitle) return { base: "", stripped: [] };

  const stripped: string[] = [];
  let version: string | undefined;

  // Pull out (...) [...] {...} segments.
  let base = String(rawTitle).replace(/[\(\[\{]([^)\]\}]*)[\)\]\}]/g, (_m, inner: string) => {
    const seg = String(inner).trim();
    if (seg) {
      stripped.push(seg);
      const hit = classifySegment(seg);
      if (hit) version ??= hit;
    }
    return " ";
  });

  // Trailing " - Something" is usually a version marker on Tidal/Qobuz.
  base = base.replace(/\s+-\s+([^-]+)$/, (_m, tail: string) => {
    const seg = String(tail).trim();
    const hit = classifySegment(seg);
    if (hit) {
      stripped.push(seg);
      version ??= hit;
      return " ";
    }
    // A noise tail ("Remastered") also gets dropped; anything else stays put.
    if (isNoiseSegment(seg)) {
      stripped.push(seg);
      return " ";
    }
    return _m;
  });

  return { base: normalizeTitle(base), version, stripped };
}

/** Returns the disqualifying version keyword in a segment, if any. */
function classifySegment(segment: string): string | undefined {
  const n = normalizeText(segment);
  if (!n) return undefined;
  for (const kw of DISQUALIFYING_VERSION) {
    const nk = normalizeText(kw);
    if (nk && (n === nk || n.includes(nk))) return nk;
  }
  return undefined;
}

function isNoiseSegment(segment: string): boolean {
  const n = normalizeText(segment);
  if (!n) return true;
  return NOISE_VERSION.some((kw) => {
    const nk = normalizeText(kw);
    return nk !== "" && (n === nk || n.startsWith(nk + " ") || n.includes(nk));
  });
}

/**
 * Split a combined artist string into individual names.
 * "Pritam, Mika Singh & Shefali Alvares" -> ["pritam","mika singh","shefali alvares"]
 */
export function splitArtists(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input.join(", ") : String(input);
  return raw
    .replace(FEATURING, " ")
    .split(/\s*(?:,|;|\/|\|| & | and | x | X | vs\.? | with )\s*/g)
    .map((s) => normalizeText(s))
    .filter((s) => s.length > 0);
}

/**
 * JioSaavn packs "artists - album" into one `subtitle` field:
 *   "Pritam, Mika Singh, Shefali Alvares - Desi Boyz"
 * The album is after the LAST " - ", since artist names may contain dashes.
 */
export function parseSubtitle(subtitle: string | null | undefined): {
  artists: string[];
  album?: string;
} {
  if (!subtitle) return { artists: [] };
  const idx = String(subtitle).lastIndexOf(" - ");
  if (idx === -1) return { artists: splitArtists(subtitle) };
  return {
    artists: splitArtists(String(subtitle).slice(0, idx)),
    album: String(subtitle).slice(idx + 3).trim() || undefined,
  };
}

/** Pull a label out of a copyright line: '℗ 2011 Super Cassettes Industries Private Limited'. */
export function parseLabel(copyright: string | null | undefined): string | undefined {
  if (!copyright) return undefined;
  const cleaned = String(copyright)
    // Alternation, not a character class -- a class here would eat every bare
    // "c" and "p" in the label name itself.
    .replace(/[©℗]|\((?:c|p)\)/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(private limited|pvt\.? ?ltd\.?|limited|ltd\.?|inc\.?|llc|gmbh|s\.a\.|b\.v\.)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

/** Token set of a normalized string. */
export function tokens(input: string): Set<string> {
  const n = normalizeText(input);
  return new Set(n ? n.split(" ") : []);
}

/** Jaccard similarity over token sets, 0..1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Levenshtein distance, iterative two-row. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Normalized string similarity 0..1 combining edit distance and token overlap. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const maxLen = Math.max(na.length, nb.length);
  const edit = 1 - levenshtein(na, nb) / maxLen;
  const tok = jaccard(tokens(na), tokens(nb));

  // Containment rescues "Subha Hone Na De" vs "Subha Hone Na De From Desi Boyz".
  const contains = na.includes(nb) || nb.includes(na) ? 0.92 : 0;

  return Math.max(contains, edit * 0.45 + tok * 0.55);
}

/** True when two version markers describe the same recording. */
export function versionsAgree(a: string | undefined, b: string | undefined): boolean {
  const na = a ? normalizeText(a) : "";
  const nb = b ? normalizeText(b) : "";
  if (!na && !nb) return true;
  if (na === nb) return true;
  // One side declares a real version and the other does not -> different recording.
  return false;
}

/** ISRCs compare case-insensitively with separators removed. */
export function normalizeIsrc(isrc: string | null | undefined): string | undefined {
  if (!isrc) return undefined;
  const n = String(isrc).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(n) ? n : undefined;
}
