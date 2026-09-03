import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { makePicture, tagStream, type FlacPicture, type FlacTags } from "../../lib/flac";
import { buildTrackFilename } from "../../lib/filename";
import { remuxFlacSegments } from "../../lib/remux";
import { withProgress } from "../../lib/stream";
import { bestMatch } from "../../mapper/score";
import type { CanonicalTrack, EngineName, EngineSearchResult } from "../../types";
import {
  NotAvailableError,
  NotConfiguredError,
  type DownloadRequest,
  type DownloadResult,
  type LosslessEngine,
  type StreamInfo,
} from "../types";
import { TidalAPI, dashSegmentUrls, type TidalStream } from "./api";
import { TidalAuth } from "./auth";
import { decryptSecurityToken, decryptStream } from "./decrypt";

const log = logger.child("tidal");

/** Segments fetched ahead of the consumer, to keep the pipe full. */
const SEGMENT_PREFETCH = 4;

export class TidalEngine implements LosslessEngine {
  readonly name: EngineName = "tidal";
  readonly auth: TidalAuth;
  readonly api: TidalAPI;

  constructor(auth = new TidalAuth()) {
    this.auth = auth;
    this.api = new TidalAPI(auth);
  }

  isConfigured(): boolean {
    return this.auth.isAuthenticated();
  }

  async search(query: string, limit = 20): Promise<EngineSearchResult[]> {
    if (!this.isConfigured()) throw new NotConfiguredError("tidal");
    return this.api.search(query, limit);
  }

  async searchByIsrc(isrc: string): Promise<EngineSearchResult[]> {
    if (!this.isConfigured()) throw new NotConfiguredError("tidal");
    return this.api.searchByIsrc(isrc);
  }

  async getTrack(id: string): Promise<EngineSearchResult | null> {
    if (!this.isConfigured()) throw new NotConfiguredError("tidal");
    try {
      return await this.api.getTrack(this.api.extractTrackId(id) ?? id);
    } catch (err) {
      log.debug(`getTrack(${id}) failed: ${String(err)}`);
      return null;
    }
  }

  async getStream(id: string, quality = "UHD"): Promise<StreamInfo> {
    if (!this.isConfigured()) throw new NotConfiguredError("tidal");
    const trackId = this.api.extractTrackId(id) ?? id;
    const stream = await this.api.getStream(trackId, quality);
    const lossless = stream.codec.toLowerCase().includes("flac");

    return {
      url: stream.kind === "direct" ? stream.url : stream.initUrl,
      format: lossless ? "flac" : "m4a",
      mimeType: lossless ? "audio/flac" : "audio/mp4",
      lossless,
      samplingRateHz: undefined,
    };
  }

  async #resolveTrack(
    input: string,
    hint?: Partial<EngineSearchResult>,
    signal?: AbortSignal,
  ): Promise<EngineSearchResult> {
    const direct = this.api.extractTrackId(input);
    if (direct) return this.api.getTrack(direct);

    const target: CanonicalTrack = {
      source: "manual",
      title: hint?.title ?? input,
      rawTitle: hint?.rawTitle ?? hint?.title ?? input,
      version: hint?.version,
      artists: hint?.artists ?? [],
      album: hint?.album,
      year: hint?.year,
      durationSec: hint?.durationSec,
      isrc: hint?.isrc,
    };

    if (target.isrc) {
      const byIsrc = await this.api.searchByIsrc(target.isrc);
      const exact = byIsrc.find((c) => c.isrc?.toUpperCase() === target.isrc?.toUpperCase());
      if (exact) return exact;
    }

    const queries = [
      [target.title, target.artists[0]].filter(Boolean).join(" "),
      target.title,
      input,
    ].filter((q, i, arr) => q && arr.indexOf(q) === i) as string[];

    for (const query of queries) {
      if (signal?.aborted) throw new Error("aborted");
      const results = await this.api.search(query, 15);
      const match = bestMatch(target, results);
      if (match) return match.candidate as EngineSearchResult;
    }

    throw new NotAvailableError("tidal", `Tidal has no match for "${input}".`);
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    if (!this.isConfigured()) throw new NotConfiguredError("tidal");
    const report = req.onProgress ?? (() => undefined);

    report("Resolving Tidal track", 8);
    const track = await this.#resolveTrack(req.input, req.hint, req.signal);

    report("Requesting Tidal stream", 18);
    const stream = await this.api.getStream(track.sourceId, req.quality);
    const lossless = stream.codec.toLowerCase().includes("flac");

    report("Fetching cover art", 24);
    const picture = await this.#fetchCover(track.coverUrl, req.signal);

    const tags = buildTags(track, stream);
    const audio =
      stream.kind === "dash"
        ? await this.#dashStream(stream, report, req.signal)
        : await this.#directStream(stream, report, req.signal);

    return {
      // A DASH remux already emits a native FLAC header, so tagging just
      // rewrites it; a direct FLAC stream is tagged the same way.
      stream: lossless ? tagStream(audio.stream, tags, picture) : audio.stream,
      filename: buildTrackFilename({
        artist: display(track)[0],
        title: track.rawTitle ?? track.title,
        extension: lossless ? ".flac" : ".m4a",
      }),
      mimeType: lossless ? "audio/flac" : "audio/mp4",
      // Never advertised: a remux has no predictable length, and tagging
      // rewrites the header, so the source length would truncate the tail.
      sizeBytes: undefined,
      track,
      tags,
    };
  }

  /** One contiguous file, optionally AES-CTR encrypted. */
  async #directStream(
    stream: Extract<TidalStream, { kind: "direct" }>,
    report: (stage: string, percent: number) => void,
    signal?: AbortSignal,
  ): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes?: number }> {
    report("Downloading from Tidal", 30);
    const res = await request(stream.url, { timeoutMs: 60_000, retries: 1, signal });
    if (!res.ok || !res.body) throw new Error(`Tidal CDN returned HTTP ${res.status}`);

    const declared = Number.parseInt(res.headers.get("Content-Length") ?? "", 10);
    const sizeBytes = Number.isFinite(declared) ? declared : undefined;

    let body = withProgress(res.body, sizeBytes, (seen, total) => {
      if (total) report("Downloading from Tidal", Math.min(95, 30 + Math.round((seen / total) * 65)));
    });

    if (stream.securityToken) {
      report("Decrypting Tidal stream", 35);
      const trackKey = await decryptSecurityToken(stream.securityToken);
      body = decryptStream(body, trackKey);
      // Decryption changes nothing about the length, but the browser would be
      // wrong to trust it if the cipher ever added framing, so drop it.
      return { stream: body, sizeBytes };
    }
    return { stream: body, sizeBytes };
  }

  /**
   * Segmented Hi-Res: fetch the init segment for the FLAC header, then stream
   * the media segments through the remuxer. Segments are prefetched a few ahead
   * so network latency does not stall the output.
   */
  async #dashStream(
    stream: Extract<TidalStream, { kind: "dash" }>,
    report: (stage: string, percent: number) => void,
    signal?: AbortSignal,
  ): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes?: number }> {
    report("Fetching Tidal init segment", 28);
    const initRes = await request(stream.initUrl, { timeoutMs: 30_000, signal });
    if (!initRes.ok) throw new Error(`Tidal init segment returned HTTP ${initRes.status}`);
    const init = new Uint8Array(await initRes.arrayBuffer());

    const urls = dashSegmentUrls(stream);
    log.info(`Tidal DASH: ${urls.length} segment(s)`);

    async function* segments(): AsyncGenerator<Uint8Array> {
      const queue: Array<Promise<Uint8Array>> = [];

      const fetchSegment = async (url: string): Promise<Uint8Array> => {
        const res = await request(url, { timeoutMs: 30_000, retries: 2, signal });
        if (!res.ok) throw new Error(`Tidal segment returned HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };

      let next = 0;
      while (next < urls.length && queue.length < SEGMENT_PREFETCH) {
        queue.push(fetchSegment(urls[next++]!));
      }

      let delivered = 0;
      while (queue.length > 0) {
        const segment = await queue.shift()!;
        if (next < urls.length) queue.push(fetchSegment(urls[next++]!));
        delivered++;
        report(
          "Downloading Tidal Hi-Res",
          Math.min(95, 30 + Math.round((delivered / urls.length) * 65)),
        );
        yield segment;
      }
    }

    return { stream: remuxFlacSegments(init, segments()), sizeBytes: undefined };
  }

  async #fetchCover(url: string | undefined, signal?: AbortSignal): Promise<FlacPicture | undefined> {
    if (!url) return undefined;
    try {
      const res = await request(url, { timeoutMs: 12_000, retries: 1, signal });
      if (!res.ok) return undefined;
      const data = new Uint8Array(await res.arrayBuffer());
      return data.length > 0 ? makePicture(data, { url }) : undefined;
    } catch (err) {
      log.warn(`cover art fetch failed: ${String(err)}`);
      return undefined;
    }
  }
}

/** Prefer original-cased names; fall back to the normalized ones. */
function display(track: EngineSearchResult): string[] {
  return track.artistNames?.length ? track.artistNames : track.artists;
}

function buildTags(track: EngineSearchResult, stream: TidalStream): FlacTags {
  const tags: FlacTags = {
    TITLE: track.rawTitle ?? track.title,
    // Original casing, never the normalized matching form.
    ARTIST: display(track).join("\n") || undefined,
    ALBUM: track.album,
    ALBUMARTIST: display(track)[0],
    TRACKNUMBER: track.trackNumber?.toString(),
    DISCNUMBER: track.discNumber?.toString(),
    ISRC: track.isrc,
    COMMENT: "ClashFLAC Lossless Engine",
    SOURCE: "Tidal",
  };
  if (track.year) {
    tags.DATE = String(track.year);
    tags.YEAR = String(track.year);
  }
  if (stream.bitrate > 0) tags.BITRATE = String(stream.bitrate);
  return tags;
}

export { TidalAPI, TidalAuth };
