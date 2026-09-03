/** Filesystem-safe names for downloaded audio. */

const ILLEGAL = /[\\/*?:"<>|]/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeFilename(name: string | null | undefined, fallback = "track"): string {
  if (!name) return fallback;
  let clean = String(name).replace(ILLEGAL, "_").replace(CONTROL, "").replace(/\s+/g, " ").trim();
  // Windows silently strips trailing dots and spaces, which breaks lookups.
  clean = clean.replace(/[. ]+$/, "");
  if (RESERVED_WINDOWS.test(clean)) clean = `_${clean}`;
  // Leave room for a directory prefix and the extension.
  if (clean.length > 120) clean = clean.slice(0, 120).trim();
  return clean || fallback;
}

export function buildTrackFilename(opts: {
  artist?: string;
  title: string;
  trackNumber?: number;
  extension?: string;
  includeTrackNumber?: boolean;
}): string {
  const ext = opts.extension ?? ".flac";
  const artist = safeFilename(opts.artist, "Unknown Artist");
  const title = safeFilename(opts.title, "track");
  const prefix =
    opts.includeTrackNumber && opts.trackNumber
      ? `${String(opts.trackNumber).padStart(2, "0")} - `
      : "";
  return `${prefix}${artist} - ${title}${ext}`;
}

/**
 * RFC 5987 Content-Disposition, giving both a plain filename for older clients
 * and a UTF-8 one so non-Latin titles survive the round trip.
 */
export function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename);
  const ascii = filename.replace(/[^\u0020-\u007e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
