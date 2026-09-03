import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { makePicture, tagStream, type FlacPicture, type FlacTags } from "../../lib/flac";
import { buildTrackFilename } from "../../lib/filename";
import { withProgress } from "../../lib/stream";
import { bestMatch } from "../../mapper/score";
import type { CanonicalTrack, EngineName, EngineSearchResult } from "../../types";
import {
  NotAvailableError,
  type DownloadRequest,
  type DownloadResult,
  type LosslessEngine,
  type StreamInfo,
} from "../types";
import { QobuzAPI } from "./api";
import { QobuzAuth } from "./auth";
import { isLossless } from "./config";

const log = logger.child("qobuz");

export class QobuzEngine implements LosslessEngine {
  readonly name: EngineName = "qobuz";
  readonly auth: QobuzAuth;
  readonly api: QobuzAPI;

  constructor(auth = new QobuzAuth()) {
    this.auth = auth;
    this.api = new QobuzAPI(auth);
  }

  /**
   * Qobuz requires a user token for the whole API, search included -- an
   * anonymous track/search now answers 401 "User authentication is required".
   * Reporting that honestly lets the mapper mark the engine unavailable rather
   * than silently returning no results.
   */
  isConfigured(): boolean {
    return this.auth.isAuthenticated();
  }

  canDownload(): boolean {
    return this.auth.isAuthenticated();
  }

  async search(query: string, limit = 20): Promise<EngineSearchResult[]> {
    return this.api.search(query, limit);
  }

  async searchByIsrc(isrc: string): Promise<EngineSearchResult[]> {
    return this.api.searchByIsrc(isrc);
  }

  async getTrack(id: string): Promise<EngineSearchResult | null> {
    const trackId = this.api.extractTrackId(id) ?? id;
    try {
      return await this.api.getTrack(trackId);
    } catch (err) {
      log.debug(`getTrack(${id}) failed: ${String(err)}`);
      return null;
    }
  }

  async getStream(id: string, quality = "UHD"): Promise<StreamInfo> {
    const trackId = this.api.extractTrackId(id) ?? id;
    const file = await this.api.getFileUrl(trackId, quality);
    const formatId = file.selected_format_id ?? file.format_id;
    const lossless = isLossless(formatId);
    return {
      url: file.url,
      format: lossless ? "flac" : "mp3",
      formatId,
      mimeType: file.mime_type ?? (lossless ? "audio/flac" : "audio/mpeg"),
      bitDepth: file.bit_depth,
      samplingRateHz: file.sampling_rate ? Math.round(file.sampling_rate * 1000) : undefined,
      lossless,
    };
  }

  /**
   * Resolve `input` to a concrete Qobuz track id.
   *
   * A bare id or URL is used directly. Free text is searched, and the results
   * are ranked against whatever metadata the caller supplied rather than
   * blindly taking the first hit.
   */
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

    // An ISRC is worth a dedicated pass, since it can settle the match outright.
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
      if (results.length === 0) continue;
      const match = bestMatch(target, results);
      if (match) return match.candidate as EngineSearchResult;
    }

    throw new NotAvailableError("qobuz", `Qobuz has no match for "${input}".`);
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    const report = req.onProgress ?? (() => undefined);
    report("Resolving Qobuz track", 8);

    const track = await this.#resolveTrack(req.input, req.hint, req.signal);
    report("Signing Qobuz stream", 18);

    const stream = await this.getStream(track.sourceId, req.quality);
    if (!stream.lossless) {
      log.warn(`Qobuz returned a lossy format (${stream.formatId}) for ${track.sourceId}`);
    }

    report("Fetching cover art", 24);
    const picture = await this.#fetchCover(track.coverUrl, req.signal);

    report("Downloading FLAC", 30);
    const audio = await request(stream.url, {
      timeoutMs: 60_000,
      retries: 1,
      signal: req.signal,
    });
    if (!audio.ok || !audio.body) {
      throw new Error(`Qobuz CDN returned HTTP ${audio.status} for track ${track.sourceId}`);
    }

    const declared = Number.parseInt(audio.headers.get("Content-Length") ?? "", 10);
    const sizeBytes = Number.isFinite(declared) ? declared : undefined;

    const tags = buildTags(track, stream);

    // Progress is measured on the wire, then the header is rewritten in flight,
    // so the audio never lands in memory.
    const counted = withProgress(audio.body, sizeBytes, (seen, total) => {
      if (!total) return;
      report("Downloading FLAC", Math.min(95, 30 + Math.round((seen / total) * 65)));
    });

    return {
      stream: stream.lossless ? tagStream(counted, tags, picture) : counted,
      filename: buildTrackFilename({
        artist: display(track)[0],
        title: track.rawTitle ?? track.title,
        extension: stream.lossless ? ".flac" : ".mp3",
      }),
      mimeType: stream.mimeType,
      // No Content-Length: tagging rewrites the metadata section, and the
      // embedded cover art alone can add megabytes, so the tagged stream is a
      // different size from the source. Declaring the upstream length here
      // truncates the response at that many bytes and corrupts the tail.
      // Chunked transfer is correct; only an untagged passthrough can declare
      // a length it actually knows.
      sizeBytes: stream.lossless ? undefined : sizeBytes,
      track,
      tags,
    };
  }

  async #fetchCover(url: string | undefined, signal?: AbortSignal): Promise<FlacPicture | undefined> {
    if (!url) return undefined;
    try {
      // Qobuz exposes larger art by swapping the size suffix on the same path.
      const large = url.replace(/_\d+\.(jpg|png)$/i, "_max.$1");
      const res = await request(large, { timeoutMs: 12_000, retries: 1, signal });
      const ok = res.ok ? res : await request(url, { timeoutMs: 12_000, signal });
      if (!ok.ok) return undefined;
      const data = new Uint8Array(await ok.arrayBuffer());
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

function buildTags(track: EngineSearchResult, stream: StreamInfo): FlacTags {
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
    SOURCE: "Qobuz",
  };
  if (track.year) {
    tags.DATE = String(track.year);
    tags.YEAR = String(track.year);
  }
  if (stream.bitDepth && stream.samplingRateHz) {
    tags.QUALITY = `${stream.bitDepth}-bit / ${(stream.samplingRateHz / 1000).toFixed(1)} kHz`;
  }
  return tags;
}

export { QobuzAPI, QobuzAuth };
