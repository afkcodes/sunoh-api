import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { extractVersion, splitArtists } from "../../lib/text";
import type { EngineSearchResult } from "../../types";
import { TidalAuth } from "./auth";
import { QUALITY_FALLBACK, TIDAL_API_URL, coverUrl, mapQuality } from "./config";

const log = logger.child("tidal.api");

/** A stream that is one contiguous file. */
export interface DirectStream {
  kind: "direct";
  url: string;
  codec: string;
  bitrate: number;
  /** Present when the stream is AES-CTR encrypted. */
  securityToken?: string;
}

/** A DASH stream delivered as an init segment plus numbered media segments. */
export interface DashStream {
  kind: "dash";
  initUrl: string;
  mediaTemplate: string;
  totalSegments: number;
  codec: string;
  bitrate: number;
}

export type TidalStream = DirectStream | DashStream;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

export class TidalAPI {
  constructor(readonly auth: TidalAuth = new TidalAuth()) {}

  /** GET a v1 endpoint, refreshing the token once on a 401. */
  async call<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
    attempt = 0,
  ): Promise<T> {
    const session = this.auth.session;
    if (!session) throw new Error("Tidal is not authenticated.");

    const res = await request(`${TIDAL_API_URL}/${endpoint.replace(/^\//, "")}`, {
      query: { countryCode: this.auth.countryCode, ...params },
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Tidal-Token": session.clientId,
      },
      timeoutMs: 15_000,
    });

    if (res.status === 401 && attempt === 0 && (await this.auth.refresh())) {
      return this.call<T>(endpoint, params, 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Tidal ${endpoint} failed: HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  }

  extractTrackId(input: string): string | null {
    const s = input.trim();
    if (/^\d+$/.test(s)) return s;
    const url = /tidal\.com\/(?:browse\/)?track\/(\d+)/i.exec(s);
    return url?.[1] ?? null;
  }

  extractAlbumId(input: string): string | null {
    return /tidal\.com\/(?:browse\/)?album\/(\d+)/i.exec(input.trim())?.[1] ?? null;
  }

  toCanonical(raw: Record<string, unknown>): EngineSearchResult {
    const album = obj(raw["album"]);
    const artists = raw["artists"];
    const rawTitle = str(raw["title"]) ?? "";
    const version = str(raw["version"]);
    const fullTitle = version ? `${rawTitle} (${version})` : rawTitle;
    const parts = extractVersion(fullTitle);

    const rawNames: string[] = Array.isArray(artists)
      ? artists.map((a) => str(obj(a)["name"]) ?? "").filter(Boolean)
      : [str(obj(raw["artist"])["name"]) ?? ""].filter(Boolean);
    const names: string[] = rawNames.flatMap((n) => splitArtists(n));

    const quality = str(raw["audioQuality"]) ?? "";
    const modes = Array.isArray(raw["mediaMetadata"])
      ? []
      : (obj(raw["mediaMetadata"])["tags"] as string[] | undefined) ?? [];

    return {
      source: "tidal",
      sourceId: String(raw["id"] ?? ""),
      title: parts.base || rawTitle,
      rawTitle: fullTitle,
      version: parts.version,
      artists: names,
      artistNames: rawNames,
      album: str(album["title"]),
      albumId: album["id"] !== undefined ? String(album["id"]) : undefined,
      year: num(String(str(raw["streamStartDate"]) ?? str(album["releaseDate"]) ?? "").slice(0, 4)),
      durationSec: num(raw["duration"]),
      isrc: str(raw["isrc"]),
      coverUrl: coverUrl(str(album["cover"])),
      explicit: Boolean(raw["explicit"]),
      trackNumber: num(raw["trackNumber"]),
      discNumber: num(raw["volumeNumber"]),
      popularity: num(raw["popularity"]),
      hires: quality === "HI_RES" || quality === "HI_RES_LOSSLESS" || modes.includes("HIRES_LOSSLESS"),
    };
  }

  async search(query: string, limit = 20): Promise<EngineSearchResult[]> {
    const data = await this.call<{ items?: Array<Record<string, unknown>> }>("search/tracks", {
      query,
      limit,
    });
    return (data.items ?? []).map((item) => this.toCanonical(item));
  }

  async getTrack(trackId: string): Promise<EngineSearchResult> {
    return this.toCanonical(await this.call<Record<string, unknown>>(`tracks/${trackId}`));
  }

  /** Tidal indexes ISRCs, so this is an exact lookup rather than a search. */
  async searchByIsrc(isrc: string): Promise<EngineSearchResult[]> {
    try {
      const data = await this.call<{ items?: Array<Record<string, unknown>> }>("tracks", {
        isrc: isrc.toUpperCase(),
      });
      return (data.items ?? []).map((item) => this.toCanonical(item));
    } catch {
      // Not every region exposes the ISRC filter; fall back to plain search.
      return this.search(isrc, 10);
    }
  }

  async getLyrics(trackId: string): Promise<string | undefined> {
    try {
      const data = await this.call<{ subtitles?: string; lyrics?: string }>(`tracks/${trackId}/lyrics`);
      return data.subtitles ?? data.lyrics;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a playable stream, walking down the quality ladder until one is
   * entitled. Ported from tidal/api.py's three-strategy resolution.
   */
  async getStream(trackId: string, quality = "UHD"): Promise<TidalStream> {
    const target = mapQuality(quality);
    const ladder = [target, ...QUALITY_FALLBACK.filter((q) => q !== target)];

    let lastError = "";
    for (const tier of ladder) {
      try {
        const stream = await this.#streamForQuality(trackId, tier);
        if (stream) return stream;
      } catch (err) {
        lastError = String(err);
        log.debug(`Tidal ${tier} unavailable for ${trackId}: ${lastError}`);
      }
    }
    throw new Error(`No playable Tidal stream for track ${trackId}${lastError ? `: ${lastError}` : ""}`);
  }

  async #streamForQuality(trackId: string, quality: string): Promise<TidalStream | null> {
    // Strategy A: the current playback endpoint, which returns a manifest.
    try {
      const info = await this.call<{
        manifestMimeType?: string;
        manifest?: string;
        audioQuality?: string;
      }>(`tracks/${trackId}/playbackinfopostpaywall`, {
        audioquality: quality,
        playbackmode: "STREAM",
        assetpresentation: "FULL",
      });

      const mime = info.manifestMimeType ?? "";
      const manifest = info.manifest ?? "";

      if (manifest && mime.includes("vnd.tidal.bts")) {
        const parsed = this.#parseBtsManifest(manifest);
        if (parsed) return parsed;
      }
      if (manifest && (mime.includes("dash+xml") || mime.includes("xml"))) {
        const parsed = this.#parseDashManifest(manifest);
        if (parsed) return parsed;
      }
    } catch (err) {
      log.debug(`playbackinfo failed for ${trackId}: ${String(err)}`);
    }

    // Strategy B: the legacy streamUrl endpoint.
    try {
      const data = await this.call<{ url?: string; codec?: string; securityToken?: string; encryptionKey?: string }>(
        `tracks/${trackId}/streamUrl`,
        { soundQuality: quality },
      );
      if (data.url) {
        const codec = data.codec ?? "flac";
        return {
          kind: "direct",
          url: data.url,
          codec,
          bitrate: codec.includes("flac") ? 1_411_000 : 320_000,
          securityToken: data.securityToken ?? data.encryptionKey,
        };
      }
    } catch {
      // Expected on modern accounts; the endpoint is deprecated.
    }

    // Strategy C: urlPostPaywall.
    try {
      const data = await this.call<{ urls?: string[]; url?: string; codec?: string }>(
        `tracks/${trackId}/urlpostpaywall`,
        { audioquality: quality, assetpresentation: "FULL", urlusagemode: "STREAM" },
      );
      const url = data.url ?? data.urls?.[0];
      if (url) {
        const codec = data.codec ?? "flac";
        return { kind: "direct", url, codec, bitrate: codec.includes("flac") ? 1_411_000 : 320_000 };
      }
    } catch {
      // Fall through.
    }

    return null;
  }

  /** BTS manifests are base64 JSON carrying direct URLs. */
  #parseBtsManifest(manifest: string): TidalStream | null {
    try {
      const json = JSON.parse(Buffer.from(manifest, "base64").toString("utf8")) as {
        urls?: string[];
        codecs?: string;
        encryptionType?: string;
        securityToken?: string;
        encryptionKey?: string;
        bitRate?: number;
      };
      const url = json.urls?.[0];
      if (!url) return null;

      const codec = json.codecs ?? "flac";
      const encrypted = (json.encryptionType ?? "NONE") !== "NONE";
      return {
        kind: "direct",
        url,
        codec,
        bitrate: json.bitRate ?? (codec.includes("flac") ? 1_411_000 : 320_000),
        securityToken: encrypted ? json.securityToken ?? json.encryptionKey : undefined,
      };
    } catch (err) {
      log.warn(`could not parse Tidal BTS manifest: ${String(err)}`);
      return null;
    }
  }

  /**
   * DASH manifests come in two shapes: a SegmentTemplate (Hi-Res, delivered as
   * numbered segments) or a plain BaseURL (one contiguous file).
   */
  #parseDashManifest(manifest: string): TidalStream | null {
    try {
      let xml = manifest;
      if (!xml.trimStart().startsWith("<")) {
        xml = Buffer.from(manifest, "base64").toString("utf8");
      }

      const initMatch = /initialization="([^"]+)"/.exec(xml);
      const mediaMatch = /media="([^"]+)"/.exec(xml);

      if (initMatch?.[1] && mediaMatch?.[1]) {
        // Each <S> element may carry r="N", meaning N additional repeats.
        let totalSegments = 0;
        for (const m of xml.matchAll(/<S\s+([^>]+)\/>/g)) {
          const repeat = /r="(\d+)"/.exec(m[1] ?? "");
          totalSegments += repeat?.[1] ? Number.parseInt(repeat[1], 10) + 1 : 1;
        }
        const codec = /codecs="([^"]+)"/.exec(xml)?.[1] ?? "flac";
        return {
          kind: "dash",
          initUrl: decodeXmlEntities(initMatch[1]),
          mediaTemplate: decodeXmlEntities(mediaMatch[1]),
          totalSegments: Math.max(totalSegments, 1),
          codec,
          bitrate: Number.parseInt(/bandwidth="(\d+)"/.exec(xml)?.[1] ?? "2400000", 10),
        };
      }

      // BaseURL form: take the highest-bandwidth representation.
      let bestUrl: string | undefined;
      let bestBitrate = -1;
      let bestCodec = "flac";
      for (const rep of xml.matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g)) {
        const attrs = rep[1] ?? "";
        const body = rep[2] ?? "";
        const bandwidth = Number.parseInt(/bandwidth="(\d+)"/.exec(attrs)?.[1] ?? "0", 10);
        const url = /<BaseURL>([\s\S]*?)<\/BaseURL>/.exec(body)?.[1]?.trim();
        if (url && bandwidth >= bestBitrate) {
          bestUrl = decodeXmlEntities(url);
          bestBitrate = bandwidth;
          bestCodec = (/codecs="([^"]+)"/.exec(attrs)?.[1] ?? "flac").toLowerCase();
        }
      }
      if (bestUrl) {
        return { kind: "direct", url: bestUrl, codec: bestCodec, bitrate: Math.max(bestBitrate, 0) };
      }
    } catch (err) {
      log.warn(`could not parse Tidal DASH manifest: ${String(err)}`);
    }
    return null;
  }
}

/** Expand a DASH media template into the concrete segment URLs. */
export function dashSegmentUrls(stream: DashStream): string[] {
  const urls: string[] = [];
  for (let i = 1; i <= stream.totalSegments; i++) {
    urls.push(
      stream.mediaTemplate
        .replace(/\$Number\$/g, String(i))
        .replace(/\$Number%0(\d+)d\$/g, (_m, width: string) => String(i).padStart(Number(width), "0")),
    );
  }
  return urls;
}
