// Shapes for sunoh-radio integration. The upstream service (separate
// repo at /home/ashish/projects/sunoh-radio, see README) maintains a
// curated PostgreSQL catalog of ~50k working radio stations + facet
// counts. We proxy it through sunoh-api so the Flutter client speaks
// only one origin and gets the unified FeedItem-style shape every other
// catalog endpoint here uses.

/** Raw station object as returned by the upstream radio service. */
export interface RadioStationUpstream {
  id: number;
  slug: string;
  name: string;
  /** Original logo URL from the scraped provider (onlineradiobox etc.). */
  image_url?: string | null;
  /** Cloudinary-hosted mirror of the logo — preferred over `image_url`
   *  because hostable URLs are stable + CDN-cached. */
  image_hosted?: string | null;
  /** `COALESCE(image_hosted, image_url)` computed server-side — kept as
   *  a convenience field but we re-derive ours in the mapper so we can
   *  emit BOTH halves to the client (it picks image_hosted with a
   *  fallback to image_url and finally a local placeholder). */
  image?: string | null;
  stream_url: string;
  countries: string[];
  genres: string[];
  languages: string[];
  status: 'working' | 'broken' | 'untested';
  codec?: string;
  bitrate?: number;
  sample_rate?: number;
}

/** Upstream pagination envelope. */
export interface RadioStationsPage {
  data: RadioStationUpstream[];
  pagination: { limit: number; offset: number; total: number };
}

/** Upstream facet row (countries / genres / languages). */
export interface RadioFacet {
  value: string;
  count: number;
}
