// sunoh-radio Station → unified FeedItem-style shape.
//
// The Flutter client's FeedItem.fromJson swallows extra fields, so we
// emit a superset (with `mediaUrls`, `stationType`, `codec`, etc.) and
// the existing renderer picks up just what it needs. type='radio_station'
// matches an existing discriminator in the Channel type and keeps the
// player happy when these flow through the queue + audio handler.
//
// Image preference (per user direction): image_hosted first (Cloudinary,
// stable + CDN-cached), fall back to image_url (original scraped logo),
// and let the client fall back to a placeholder when neither exists.

import type { Images } from '../types';
import type { RadioStationUpstream } from './types';

const SOURCE = 'sunoh-radio';

function buildImages(s: RadioStationUpstream): Images {
  const hosted = s.image_hosted?.trim() || '';
  const original = s.image_url?.trim() || '';
  // Emit both qualities so the Flutter art picker can fall back
  // gracefully — UI iterates by quality and uses the first that loads.
  const out: Images = [];
  if (hosted) out.push({ quality: '500x500', link: hosted });
  if (original && original !== hosted) {
    out.push({ quality: '150x150', link: original });
  }
  return out;
}

/** Best-effort subtitle: prefer the first genre (more descriptive than
 *  the country code), fall back to country. Empty string when neither
 *  is available — the Flutter side hides the row when nothing's there. */
function buildSubtitle(s: RadioStationUpstream): string | undefined {
  const genre = s.genres?.[0]?.trim();
  if (genre) return genre;
  const country = s.countries?.[0]?.trim();
  return country || undefined;
}

export function mapRadioStation(s: RadioStationUpstream) {
  return {
    // slug is stable, name-scoped, and what /stations/:slug resolves to.
    id: s.slug,
    title: s.name,
    subtitle: buildSubtitle(s),
    type: 'radio_station' as const,
    image: buildImages(s),
    // The Flutter resolver picks up mediaUrls tier-1 — no upstream
    // refetch needed to start playback. Marker quality='live' so the
    // resolver doesn't try to pick by bitrate (these are streams, not
    // discrete files).
    mediaUrls: [{ quality: 'live', link: s.stream_url }],
    source: SOURCE,
    stationType: 'live' as const,
    // Optional metadata — kept for the Flutter UI to surface
    // "lossless"-style badges if we ever want them. Codec/bitrate are
    // upstream-validated by FFprobe so they're trustworthy.
    language: s.languages?.[0],
    // Extra fields below ride through FeedItem.fromJson's "extra keys
    // ignored" pass — not part of the standard schema but useful for
    // facet UIs.
    countries: s.countries ?? [],
    genres: s.genres ?? [],
    codec: s.codec,
    bitrate: s.bitrate,
  };
}

export function mapRadioStations(list: RadioStationUpstream[] | undefined | null) {
  if (!Array.isArray(list)) return [];
  return list.map(mapRadioStation);
}
