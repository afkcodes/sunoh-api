/**
 * Minimal MPEG-DASH manifest parsing.
 *
 * Only what is needed to locate the highest-quality audio representation and
 * enumerate its segments. A full DASH parser is unnecessary: these manifests
 * are machine-generated and use a narrow subset of the specification.
 */

export interface DashRepresentation {
  id?: string;
  codecs: string;
  bandwidth: number;
  audioSamplingRate?: number;
  /** Present for single-file representations. */
  baseUrl?: string;
  /** Present for segmented representations. */
  initUrl?: string;
  mediaTemplate?: string;
  segmentCount?: number;
  startNumber: number;
}

export interface ParsedMpd {
  representations: DashRepresentation[];
  /** The highest-bandwidth representation, preferring FLAC. */
  best: DashRepresentation | null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m?.[1] !== undefined ? decodeEntities(m[1]) : undefined;
}

function intAttr(tag: string, name: string, fallback = 0): number {
  const value = attr(tag, name);
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Count segments described by a SegmentTimeline, honouring r="N" repeats. */
function countTimelineSegments(xml: string): number {
  let total = 0;
  for (const m of xml.matchAll(/<S\b([^>]*)\/?>/g)) {
    const repeat = intAttr(m[1] ?? "", "r", 0);
    total += repeat + 1;
  }
  return total;
}

/**
 * Resolve a possibly-relative URL against the manifest's own location and any
 * enclosing BaseURL element.
 */
export function resolveUrl(url: string, base?: string): string {
  if (!base || /^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function parseMpd(xml: string, baseUrl?: string): ParsedMpd {
  const representations: DashRepresentation[] = [];

  // A BaseURL at the MPD or Period level applies to everything beneath it.
  const documentBase = /<BaseURL>([\s\S]*?)<\/BaseURL>/.exec(xml)?.[1]?.trim();
  const effectiveBase = documentBase ? resolveUrl(decodeEntities(documentBase), baseUrl) : baseUrl;

  for (const adaptation of xml.matchAll(
    /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g,
  )) {
    const setAttrs = adaptation[1] ?? "";
    const setBody = adaptation[2] ?? "";

    const mimeType = attr(setAttrs, "mimeType") ?? attr(setAttrs, "contentType") ?? "";
    if (mimeType && !mimeType.includes("audio")) continue;

    // A SegmentTemplate may sit on the AdaptationSet and be inherited.
    const setTemplate = /<SegmentTemplate\b([^>]*)\/?>/.exec(setBody)?.[1];

    for (const rep of setBody.matchAll(/<Representation\b([^>]*)(?:\/>|>([\s\S]*?)<\/Representation>)/g)) {
      const repAttrs = rep[1] ?? "";
      const repBody = rep[2] ?? "";

      const repTemplateTag = /<SegmentTemplate\b([^>]*)\/?>/.exec(repBody)?.[1] ?? setTemplate;
      const timelineXml = /<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/.exec(repBody)?.[1] ?? "";

      const baseUrlTag = /<BaseURL>([\s\S]*?)<\/BaseURL>/.exec(repBody)?.[1]?.trim();

      const representation: DashRepresentation = {
        id: attr(repAttrs, "id"),
        codecs: (attr(repAttrs, "codecs") ?? attr(setAttrs, "codecs") ?? "").toLowerCase(),
        bandwidth: intAttr(repAttrs, "bandwidth", 0),
        audioSamplingRate:
          intAttr(repAttrs, "audioSamplingRate", 0) ||
          intAttr(setAttrs, "audioSamplingRate", 0) ||
          undefined,
        startNumber: repTemplateTag ? intAttr(repTemplateTag, "startNumber", 1) : 1,
      };

      if (baseUrlTag) {
        representation.baseUrl = resolveUrl(decodeEntities(baseUrlTag), effectiveBase);
      }

      if (repTemplateTag) {
        const init = attr(repTemplateTag, "initialization");
        const media = attr(repTemplateTag, "media");
        if (init) representation.initUrl = resolveUrl(applyIdentity(init, representation), effectiveBase);
        if (media) representation.mediaTemplate = resolveUrl(applyIdentity(media, representation), effectiveBase);
        if (timelineXml) representation.segmentCount = countTimelineSegments(timelineXml);
      }

      if (representation.baseUrl || representation.initUrl) representations.push(representation);
    }
  }

  // Prefer lossless, then bandwidth.
  const sorted = [...representations].sort((a, b) => {
    const aFlac = a.codecs.includes("flac") ? 1 : 0;
    const bFlac = b.codecs.includes("flac") ? 1 : 0;
    if (aFlac !== bFlac) return bFlac - aFlac;
    return b.bandwidth - a.bandwidth;
  });

  return { representations, best: sorted[0] ?? null };
}

/** Substitute $RepresentationID$ and strip $Bandwidth$ placeholders. */
function applyIdentity(template: string, rep: DashRepresentation): string {
  return template
    .replace(/\$RepresentationID\$/g, rep.id ?? "")
    .replace(/\$Bandwidth\$/g, String(rep.bandwidth));
}

/** Expand a media template into concrete segment URLs. */
export function segmentUrls(rep: DashRepresentation): string[] {
  if (!rep.mediaTemplate) return [];
  const count = rep.segmentCount ?? 0;
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    const number = rep.startNumber + i;
    urls.push(
      rep.mediaTemplate
        .replace(/\$Number%0(\d+)d\$/g, (_m, width: string) =>
          String(number).padStart(Number(width), "0"),
        )
        .replace(/\$Number\$/g, String(number)),
    );
  }
  return urls;
}
