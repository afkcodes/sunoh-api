import { randomUUID } from "node:crypto";
import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { extractVersion, splitArtists } from "../../lib/text";
import type { EngineSearchResult } from "../../types";
import { AmazonAuth } from "./auth";
import {
  APP_USER_AGENT,
  APP_VERSION,
  DEVICE_TYPE,
  HARLEY_VERSION,
  WEB_USER_AGENT,
  type AmazonRegion,
} from "./models";

const log = logger.child("amazon.api");

/** Entitlements the app advertises; the server picks what the account allows. */
const ENTITLEMENTS = ["NIGHTWING", "SONIC_RUSH", "HAWKFIRE", "ROBIN", "KATANA", "MERCURY"];

export interface DashManifest {
  /** Base64 PSSH for the Widevine license request. */
  pssh?: string;
  /** The MPD document, or a URL to fetch it from. */
  manifestUrl?: string;
  manifest?: string;
  contentId?: string;
}

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

export class AmazonAPI {
  constructor(readonly auth: AmazonAuth = new AmazonAuth()) {}

  #region(): AmazonRegion {
    const region = this.auth.region;
    if (!region) throw new Error("Amazon Music is not authenticated.");
    return region;
  }

  /** Signed POST against a music.amazon.<tld> service endpoint. */
  async post<T>(
    path: string,
    body: unknown,
    opts: { target?: string; userAgent?: string; extraHeaders?: Record<string, string> } = {},
  ): Promise<T> {
    await this.auth.ensureFreshToken();
    const region = this.#region();
    const origin = `https://music.amazon.${region.domainTld}`;
    const fullPath = `/${region.region}/api/${path.replace(/^\//, "")}`;
    const payload = JSON.stringify(body);

    const headers: Record<string, string> = {
      "User-Agent": opts.userAgent ?? APP_USER_AGENT,
      "android-app-version": APP_VERSION,
      "content-encoding": "amz-1.0",
      accept: "application/json",
      "accept-charset": "utf-8",
      "content-type": "application/json; charset=UTF-8",
      "X-Amz-RequestId": randomUUID(),
      Origin: origin,
      Referer: `${origin}/`,
      ...(opts.target ? { "X-Amz-Target": opts.target } : {}),
      ...this.auth.signHeaders("POST", fullPath, payload),
      ...(opts.extraHeaders ?? {}),
    };

    const cookies = this.auth.cookieHeader();
    if (cookies) headers["Cookie"] = cookies;

    const res = await request(`${origin}${fullPath}`, {
      method: "POST",
      headers,
      body: payload,
      timeoutMs: 30_000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Amazon ${path} failed: HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
    }
    return (await res.json()) as T;
  }

  extractAsin(input: string): string | null {
    const s = input.trim();
    if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
    const m = /(?:trackAsin=|albums\/|tracks\/)([A-Z0-9]{10})/i.exec(s);
    return m?.[1]?.toUpperCase() ?? null;
  }

  toCanonical(raw: Record<string, unknown>): EngineSearchResult {
    const rawTitle = str(raw["title"]) ?? str(raw["name"]) ?? "";
    const parts = extractVersion(rawTitle);
    const artistName = str(raw["artistName"]) ?? str(obj(raw["artist"])["name"]);

    return {
      source: "amazon",
      sourceId: str(raw["asin"]) ?? str(raw["identifier"]) ?? "",
      title: parts.base || rawTitle,
      rawTitle,
      version: parts.version,
      artists: artistName ? splitArtists(artistName) : [],
      artistNames: artistName ? [artistName] : [],
      album: str(raw["albumName"]) ?? str(obj(raw["album"])["title"]),
      albumId: str(raw["albumAsin"]),
      year: num(String(str(raw["originalReleaseDate"]) ?? "").slice(0, 4)),
      // Amazon reports duration in seconds on the catalog endpoints.
      durationSec: num(raw["durationSeconds"]) ?? num(raw["duration"]),
      isrc: str(raw["isrc"]),
      coverUrl: str(raw["albumCoverImageFull"]) ?? str(raw["image"]),
      trackNumber: num(raw["trackNum"]) ?? num(raw["trackNumber"]),
      discNumber: num(raw["discNum"]) ?? num(raw["discNumber"]),
      explicit: String(raw["parentalControls"] ?? "").includes("EXPLICIT"),
      hires: true,
    };
  }

  async search(query: string, limit = 20): Promise<EngineSearchResult[]> {
    const region = this.#region();
    const data = await this.post<Record<string, unknown>>(
      "search/v1_1/",
      {
        keyword: query,
        userHash: { level: "LIBRARY_MEMBER" },
        headers: JSON.stringify({
          "x-amzn-authentication": JSON.stringify({ interface: "ClientAuthenticationInterface.v1_0.ClientTokenElement", accessToken: this.auth.credentials?.accessToken }),
          "x-amzn-device-model": "Pixel 5",
          "x-amzn-device-width": "1080",
          "x-amzn-device-family": "Android",
          "x-amzn-device-id": this.auth.credentials?.deviceInfo.deviceSerialNumber,
          "x-amzn-user-agent": APP_USER_AGENT,
          "x-amzn-device-time-zone": "UTC",
          "x-amzn-music-domain": "music.amazon.com",
          "x-amzn-request-id": randomUUID(),
          "x-amzn-csrf": "",
          "x-amzn-app-version": APP_VERSION,
          "x-amzn-os-version": "13",
          "x-amzn-timestamp": String(Date.now()),
        }),
        marketplaceId: region.marketplaceId,
      },
      { target: "com.amazon.tenzing.v1_1.TenzingServiceExternalV1_1.search" },
    );

    return collectTrackDocuments(data)
      .map((doc) => this.toCanonical(doc))
      .filter((t) => t.sourceId)
      .slice(0, limit);
  }

  async getTrackMetadata(asin: string): Promise<EngineSearchResult | null> {
    const region = this.#region();
    const data = await this.post<Record<string, unknown>>(
      "muse/legacy/lookup",
      {
        asins: [asin],
        features: ["popularity", "expandTracklist", "trackLibraryAvailability", "collectionLibraryAvailability"],
        requestedContent: "MUSIC_SUBSCRIPTION",
        marketplaceId: region.marketplaceId,
        deviceId: this.auth.credentials?.deviceInfo.deviceSerialNumber,
        deviceType: DEVICE_TYPE.MUSIC,
        musicRequestIdentity: this.auth.credentials?.customerId,
      },
      { target: "com.amazon.musicensembleservice.MusicEnsembleService.lookup" },
    );

    const track = collectTrackDocuments(data)[0];
    return track ? this.toCanonical(track) : null;
  }

  /** Fetch the DASH manifest and the PSSH needed for the license request. */
  async getDashManifest(asin: string): Promise<DashManifest> {
    const region = this.#region();
    const musicAgent = `Harley/${HARLEY_VERSION} Harley/${APP_VERSION} ( ${randomUUID()} ${asin} )`;

    const data = await this.post<Record<string, unknown>>(
      "dmls/getDashManifestsV2",
      {
        appInfo: { musicAgent },
        contentIdList: [{ identifier: asin, identifierType: "ASIN" }],
        contentProtectionList: ["GROUP_PSSH", "TRACK_PSSH"],
        customerInfo: {
          entitlementList: ENTITLEMENTS,
          marketplaceId: region.marketplaceId,
          territoryId: region.country,
        },
        customerId: this.auth.credentials?.customerId,
        deviceToken: {
          deviceId: this.auth.credentials?.deviceInfo.deviceSerialNumber,
          deviceTypeId: DEVICE_TYPE.MUSIC,
        },
        musicDashVersionList: ["SIREN_KATANA"],
      },
      {
        target:
          "com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.getDashManifestsV2",
        userAgent: WEB_USER_AGENT,
        extraHeaders: { Accept: "application/json, text/javascript, */*" },
      },
    );

    const entry = findManifestEntry(data);
    if (!entry) throw new Error(`Amazon returned no DASH manifest for ${asin}`);
    return entry;
  }

  /** Exchange a Widevine challenge for a license. */
  async getLicense(asin: string, challenge: string, drmType = "WIDEVINE"): Promise<string> {
    const musicAgent = `Harley/${HARLEY_VERSION} Harley/${APP_VERSION} ( ${randomUUID()} ${asin} )`;
    const data = await this.post<{ license?: string }>(
      "dmls/getLicenseForPlaybackV2",
      {
        DrmType: drmType,
        appInfo: { musicAgent },
        deviceToken: {
          deviceId: this.auth.credentials?.deviceInfo.deviceSerialNumber,
          deviceTypeId: DEVICE_TYPE.MUSIC,
        },
        licenseChallenge: challenge,
        persistent: false,
      },
      {
        target:
          "com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.getLicenseForPlaybackV2",
        userAgent: WEB_USER_AGENT,
      },
    );

    if (!data.license) throw new Error("Amazon license response carried no license");
    return data.license;
  }
}

/** Walk an arbitrarily nested response collecting anything that looks like a track. */
export function collectTrackDocuments(data: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const asin = record["asin"];
    // A track document has an ASIN plus a title; albums lack durationSeconds.
    if (typeof asin === "string" && /^[A-Z0-9]{10}$/i.test(asin) && (record["title"] || record["name"])) {
      if (!seen.has(asin)) {
        seen.add(asin);
        out.push(record);
      }
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };

  visit(data, 0);
  return out;
}

/** Pull the first usable manifest plus PSSH out of a getDashManifestsV2 response. */
export function findManifestEntry(data: unknown): DashManifest | null {
  let found: DashManifest | null = null;

  const visit = (node: unknown, depth: number): void => {
    if (found || depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;

    const manifest = str(record["manifest"]) ?? str(record["dashManifest"]);
    const manifestUrl = str(record["manifestUrl"]) ?? str(record["url"]);
    const pssh =
      str(record["pssh"]) ??
      str(record["trackPssh"]) ??
      str(record["groupPssh"]) ??
      str(obj(record["contentProtection"])["pssh"]);

    if (manifest || manifestUrl) {
      found = {
        manifest,
        manifestUrl,
        pssh,
        contentId: str(record["contentId"]) ?? str(record["identifier"]),
      };
      if (pssh) return;
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };

  visit(data, 0);
  if (found) log.debug("located Amazon DASH manifest entry");
  return found;
}
