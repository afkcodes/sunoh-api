import { createHash } from "node:crypto";
import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { splitArtists, extractVersion } from "../../lib/text";
import type { EngineSearchResult } from "../../types";
import { QobuzAuth } from "./auth";
import { FORMAT_FALLBACK_ORDER, QOBUZ_API_BASE, getFormatId, isLossless } from "./config";

const log = logger.child("qobuz.api");

export interface QobuzFileUrl {
  url: string;
  format_id?: number;
  selected_format_id?: number;
  mime_type?: string;
  bit_depth?: number;
  sampling_rate?: number;
  sample?: boolean;
  [key: string]: unknown;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

/** Qobuz track/album payloads are loosely typed; these helpers keep access safe. */
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

export class QobuzAPI {
  constructor(readonly auth: QobuzAuth = new QobuzAuth()) {}

  #headers(appId?: string): Record<string, string> {
    const headers: Record<string, string> = { "X-App-Id": appId ?? this.auth.appId };
    if (this.auth.userAuthToken) headers["X-User-Auth-Token"] = this.auth.userAuthToken;
    return headers;
  }

  /** GET an endpoint, rotating accounts on 401 and app ids on 400. */
  async call<T>(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    await this.auth.ensureCredentials();
    const attempts = Math.max(1, this.auth.accounts.length);

    let lastError = "";
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const appId of this.auth.appIdCandidates().length ? this.auth.appIdCandidates() : [this.auth.appId]) {
        const query: Record<string, string | number | undefined> = { ...params, app_id: appId };
        if (this.auth.userAuthToken) query["user_auth_token"] = this.auth.userAuthToken;

        const res = await request(`${QOBUZ_API_BASE}${endpoint}`, {
          query,
          headers: this.#headers(appId),
          timeoutMs: 12_000,
        });

        if (res.ok) {
          this.auth.appId = appId;
          return (await res.json()) as T;
        }

        // Surface the API's own message; Qobuz explains refusals clearly and
        // silently returning the error body as data hides real failures.
        const detail = await res
          .json()
          .then((b) => (b as { message?: string }).message)
          .catch(() => undefined);
        lastError = `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;

        // 401 means the account is wrong, not the app id, so stop trying ids.
        if (res.status === 401) break;
        // Anything other than a bad-app-id 400 will not improve on retry.
        if (res.status !== 400) throw new Error(`Qobuz ${endpoint} failed: ${lastError}`);
      }
      if (!this.auth.rotate()) break;
    }
    throw new Error(`Qobuz ${endpoint} failed: ${lastError || "unknown error"}`);
  }

  extractTrackId(input: string): string | null {
    const s = input.trim();
    if (/^\d+$/.test(s)) return s;
    const url = /(?:open|play)\.qobuz\.com\/(?:[a-z]{2}-[a-z]{2}\/)?track\/(\d+)/i.exec(s);
    if (url?.[1]) return url[1];
    const uri = /qobuz:track:(\d+)/i.exec(s);
    return uri?.[1] ?? null;
  }

  extractAlbumId(input: string): string | null {
    return /(?:open|play)\.qobuz\.com\/(?:[a-z]{2}-[a-z]{2}\/)?album\/([a-zA-Z0-9]+)/i.exec(input.trim())?.[1] ?? null;
  }

  /** Map a raw Qobuz track object into the canonical shape. */
  toCanonical(raw: Record<string, unknown>): EngineSearchResult {
    const album = obj(raw["album"]);
    const image = obj(album["image"]);
    const performer = obj(raw["performer"]);
    const albumArtist = obj(album["artist"]);

    const rawTitle = str(raw["title"]) ?? "";
    const version = str(raw["version"]);
    const fullTitle = version ? `${rawTitle} (${version})` : rawTitle;
    const parts = extractVersion(fullTitle);

    const releaseDate =
      str(raw["release_date_original"]) ?? str(raw["release_date"]) ?? str(album["release_date_original"]);

    const artistName = str(performer["name"]) ?? str(obj(raw["artist"])["name"]);
    const bitDepth = num(raw["maximum_bit_depth"]) ?? num(album["maximum_bit_depth"]);
    const sampleRate = num(raw["maximum_sampling_rate"]) ?? num(album["maximum_sampling_rate"]);

    return {
      source: "qobuz",
      sourceId: String(raw["id"] ?? ""),
      title: parts.base || rawTitle,
      rawTitle: fullTitle,
      version: parts.version,
      artists: artistName ? splitArtists(artistName) : [],
      artistNames: artistName ? [artistName] : [],
      album: str(album["title"]),
      albumId: str(album["id"]),
      year: releaseDate ? num(releaseDate.slice(0, 4)) : undefined,
      durationSec: num(raw["duration"]),
      isrc: str(raw["isrc"]),
      coverUrl: str(image["large"]) ?? str(image["extralarge"]) ?? str(image["small"]),
      trackNumber: num(raw["track_number"]),
      discNumber: num(raw["media_number"]),
      explicit: Boolean(raw["parental_warning"]),
      hires: Boolean(raw["hires"] ?? album["hires"]),
      bitDepth,
      samplingRateHz: sampleRate ? Math.round(sampleRate * 1000) : undefined,
      popularity: num(album["popularity"]),
    };
  }

  /**
   * Search the catalogue. The query is expanded into a few variants because
   * Qobuz's matcher is literal about punctuation, then results are merged.
   */
  async search(query: string, limit = 20): Promise<EngineSearchResult[]> {
    const raw = query.trim();
    if (!raw) return [];

    const variants = new Set<string>([raw]);
    const cleaned = raw.replace(/[&,|+()\[\]]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned) variants.add(cleaned);
    const words = cleaned.split(" ").filter(Boolean);
    if (words.length > 2) variants.add(`${words[0]} ${words[words.length - 1]}`);

    const responses = await Promise.allSettled(
      [...variants].slice(0, 3).map((q) =>
        this.call<{ tracks?: { items?: Array<Record<string, unknown>> } }>("track/search", {
          query: q,
          limit: Math.max(limit, 12),
        }),
      ),
    );

    // If every variant failed, that is an outage or an auth problem, not an
    // empty catalogue -- report it rather than returning a misleading [].
    if (responses.every((r) => r.status === "rejected")) {
      const first = responses[0];
      throw first?.status === "rejected"
        ? (first.reason as Error)
        : new Error("Qobuz search failed");
    }

    const seen = new Set<string>();
    const out: EngineSearchResult[] = [];
    for (const settled of responses) {
      if (settled.status !== "fulfilled") continue;
      for (const item of settled.value.tracks?.items ?? []) {
        const id = String(item["id"] ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(this.toCanonical(item));
      }
    }
    return out.slice(0, limit);
  }

  async getTrack(trackId: string): Promise<EngineSearchResult> {
    const raw = await this.call<Record<string, unknown>>("track/get", { track_id: trackId });
    return this.toCanonical(raw);
  }

  /**
   * Request a signed CDN stream URL.
   *
   * The signature is md5 of the concatenated method name, sorted parameters,
   * timestamp and app secret. Qobuz rotates secrets, so every known candidate
   * is tried, and the one that works is remembered for later calls.
   */
  async getFileUrl(trackId: string, quality = "UHD"): Promise<QobuzFileUrl> {
    await this.auth.ensureCredentials();

    const requested = getFormatId(quality);
    const formats = [requested, ...FORMAT_FALLBACK_ORDER.filter((f) => f !== requested)];
    const accountAttempts = Math.max(1, this.auth.accounts.length);

    let lastError = "";
    for (let attempt = 0; attempt < accountAttempts; attempt++) {
      const secrets = this.auth.allSecrets();
      if (secrets.length === 0) lastError = "no Qobuz app secret available";

      for (const formatId of formats) {
        for (const secret of secrets) {
          const ts = Math.floor(Date.now() / 1000);
          const signature = md5(
            `trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}${ts}${secret}`,
          );

          const res = await request(`${QOBUZ_API_BASE}track/getFileUrl`, {
            query: {
              request_ts: ts,
              request_sig: signature,
              track_id: trackId,
              format_id: formatId,
              intent: "stream",
              app_id: this.auth.appId,
              ...(this.auth.userAuthToken ? { user_auth_token: this.auth.userAuthToken } : {}),
            },
            headers: this.#headers(),
            timeoutMs: 12_000,
            retries: 1,
          });

          if (res.status === 401) {
            lastError = `HTTP 401 for account ${this.auth.userId ?? "anonymous"}`;
            break;
          }
          if (!res.ok) {
            lastError = `HTTP ${res.status}`;
            continue;
          }

          const data = (await res.json()) as QobuzFileUrl;
          if (!data.url) {
            lastError = "response carried no url";
            continue;
          }
          // A 30-second preview is not a download; keep looking.
          if (data.sample) {
            lastError = "Qobuz returned a sample, not the full track";
            continue;
          }

          this.auth.appSecret = secret;
          data.selected_format_id = formatId;
          log.debug(`signed Qobuz stream for ${trackId} at format ${formatId}`);
          return data;
        }
      }
      if (!this.auth.rotate()) break;
    }

    throw new Error(
      `Could not retrieve a Qobuz stream URL for track ${trackId}: ${lastError || "invalid signature or restricted track"}`,
    );
  }

  /** Look a track up by ISRC. Qobuz has no ISRC endpoint, so this searches and filters. */
  async searchByIsrc(isrc: string, limit = 10): Promise<EngineSearchResult[]> {
    const results = await this.search(isrc, limit);
    const exact = results.filter((r) => r.isrc?.toUpperCase() === isrc.toUpperCase());
    return exact.length > 0 ? exact : results;
  }
}

export { isLossless };
