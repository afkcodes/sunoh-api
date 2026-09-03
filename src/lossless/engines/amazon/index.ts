import { config } from "../../config";
import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { makePicture, tagStream, type FlacPicture, type FlacTags } from "../../lib/flac";
import { buildTrackFilename } from "../../lib/filename";
import { parseMpd, segmentUrls, type DashRepresentation } from "../../lib/mpd";
import { remuxFlac, remuxFlacSegments } from "../../lib/remux";
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
import { AmazonAPI } from "./api";
import { AmazonAuth } from "./auth";
import { createSegmentDecryptor, decryptMp4 } from "./cenc";
import { CdmSession } from "./widevine/cdm";
import { parseDeviceBase64, loadDeviceFile, type WidevineDevice } from "./widevine/device";
import { EMBEDDED_WVD } from "./widevine/embedded-device";
import { findPsshInInit } from "./widevine/pssh";

const log = logger.child("amazon");

const SEGMENT_PREFETCH = 4;

export class AmazonEngine implements LosslessEngine {
  readonly name: EngineName = "amazon";
  readonly auth: AmazonAuth;
  readonly api: AmazonAPI;
  #device: WidevineDevice | null = null;

  constructor(auth = new AmazonAuth()) {
    this.auth = auth;
    this.api = new AmazonAPI(auth);
  }

  isConfigured(): boolean {
    return this.auth.isAuthenticated();
  }

  /** The provisioned CDM: a device file if configured, else the embedded one. */
  async device(): Promise<WidevineDevice> {
    if (this.#device) return this.#device;
    if (config.amazon.wvdPath) {
      try {
        this.#device = await loadDeviceFile(config.amazon.wvdPath);
        log.info(`loaded Widevine device from ${config.amazon.wvdPath}`);
        return this.#device;
      } catch (err) {
        log.warn(`could not load ${config.amazon.wvdPath}, using the embedded device: ${String(err)}`);
      }
    }
    this.#device = parseDeviceBase64(EMBEDDED_WVD);
    return this.#device;
  }

  async search(query: string, limit = 20): Promise<EngineSearchResult[]> {
    if (!this.isConfigured()) throw new NotConfiguredError("amazon");
    return this.api.search(query, limit);
  }

  async getTrack(id: string): Promise<EngineSearchResult | null> {
    if (!this.isConfigured()) throw new NotConfiguredError("amazon");
    const asin = this.api.extractAsin(id);
    if (!asin) return null;
    try {
      return await this.api.getTrackMetadata(asin);
    } catch (err) {
      log.debug(`getTrack(${id}) failed: ${String(err)}`);
      return null;
    }
  }

  async getStream(id: string): Promise<StreamInfo> {
    if (!this.isConfigured()) throw new NotConfiguredError("amazon");
    const asin = this.api.extractAsin(id);
    if (!asin) throw new NotAvailableError("amazon", `"${id}" is not an Amazon ASIN.`);

    const manifest = await this.api.getDashManifest(asin);
    const { representation } = await this.#resolveRepresentation(manifest);

    return {
      url: representation.baseUrl ?? representation.initUrl ?? "",
      format: representation.codecs.includes("flac") ? "flac" : "m4a",
      mimeType: representation.codecs.includes("flac") ? "audio/flac" : "audio/mp4",
      lossless: representation.codecs.includes("flac"),
      samplingRateHz: representation.audioSamplingRate,
    };
  }

  /** Fetch and parse the MPD, returning the best audio representation. */
  async #resolveRepresentation(
    manifest: { manifest?: string; manifestUrl?: string; pssh?: string },
    signal?: AbortSignal,
  ): Promise<{ representation: DashRepresentation; pssh?: string }> {
    let xml = manifest.manifest;
    let base = manifest.manifestUrl;

    if (!xml && manifest.manifestUrl) {
      const res = await request(manifest.manifestUrl, { timeoutMs: 30_000, signal });
      if (!res.ok) throw new Error(`Amazon MPD returned HTTP ${res.status}`);
      xml = await res.text();
      base = res.url || manifest.manifestUrl;
    }
    if (!xml) throw new Error("Amazon returned no DASH manifest document");

    // The manifest may itself be base64 rather than raw XML.
    if (!xml.trimStart().startsWith("<")) {
      xml = Buffer.from(xml, "base64").toString("utf8");
    }

    const parsed = parseMpd(xml, base);
    if (!parsed.best) throw new Error("Amazon MPD contained no usable audio representation");
    return { representation: parsed.best, pssh: manifest.pssh };
  }

  async #resolveTrack(
    input: string,
    hint?: Partial<EngineSearchResult>,
    signal?: AbortSignal,
  ): Promise<EngineSearchResult> {
    const asin = this.api.extractAsin(input);
    if (asin) {
      const track = await this.api.getTrackMetadata(asin);
      if (track) return track;
      // Metadata lookup can fail on a valid ASIN; carry on with the id alone.
      return { source: "amazon", sourceId: asin, title: hint?.title ?? asin, artists: hint?.artists ?? [] };
    }

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

    throw new NotAvailableError("amazon", `Amazon Music has no match for "${input}".`);
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    if (!this.isConfigured()) throw new NotConfiguredError("amazon");
    const report = req.onProgress ?? (() => undefined);

    report("Resolving Amazon track", 8);
    const track = await this.#resolveTrack(req.input, req.hint, req.signal);

    report("Fetching Amazon manifest", 16);
    const manifest = await this.api.getDashManifest(track.sourceId);
    const { representation } = await this.#resolveRepresentation(manifest, req.signal);
    const lossless = representation.codecs.includes("flac");

    report("Fetching init segment", 22);
    const initUrl = representation.initUrl ?? representation.baseUrl;
    if (!initUrl) throw new Error("Amazon representation carried no URL");

    const initRes = await request(initUrl, { timeoutMs: 30_000, signal: req.signal });
    if (!initRes.ok) throw new Error(`Amazon init segment returned HTTP ${initRes.status}`);
    const init = new Uint8Array(await initRes.arrayBuffer());

    // The PSSH may arrive with the manifest or be embedded in the init segment.
    const pssh = manifest.pssh ?? (findPsshInInit(init) ? Buffer.from(findPsshInInit(init)!).toString("base64") : undefined);

    report("Acquiring Widevine licence", 30);
    const contentKey = pssh ? await this.#getContentKey(track.sourceId, pssh) : null;
    if (!contentKey) log.warn(`no PSSH for ${track.sourceId}; assuming the stream is unencrypted`);

    report("Fetching cover art", 34);
    const picture = await this.#fetchCover(track.coverUrl, req.signal);
    const tags = buildTags(track, representation);

    const audio = representation.mediaTemplate
      ? await this.#segmentedStream(representation, init, contentKey, report, req.signal)
      : await this.#singleFileStream(representation, contentKey, report, req.signal);

    return {
      stream: lossless ? tagStream(audio, tags, picture) : audio,
      filename: buildTrackFilename({
        artist: display(track)[0],
        title: track.rawTitle ?? track.title,
        extension: lossless ? ".flac" : ".m4a",
      }),
      mimeType: lossless ? "audio/flac" : "audio/mp4",
      track,
      tags,
    };
  }

  async #getContentKey(asin: string, pssh: string): Promise<string> {
    const session = new CdmSession(await this.device());
    const challenge = session.getLicenseChallenge(pssh);
    const license = await this.api.getLicense(asin, challenge);
    const keys = session.parseLicense(license);
    log.debug(`recovered ${keys.length} key(s) for ${asin}`);
    return CdmSession.contentKey(keys);
  }

  /** A single contiguous fMP4: fetch, decrypt, remux. */
  async #singleFileStream(
    representation: DashRepresentation,
    contentKey: string | null,
    report: (stage: string, percent: number) => void,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    report("Downloading from Amazon", 40);
    const res = await request(representation.baseUrl!, { timeoutMs: 120_000, retries: 1, signal });
    if (!res.ok) throw new Error(`Amazon CDN returned HTTP ${res.status}`);

    // A single-file CENC MP4 must be complete before it can be decrypted, so
    // this path does buffer; segmented streams below do not.
    let buf: Uint8Array = new Uint8Array(await res.arrayBuffer());
    report("Decrypting", 75);
    if (contentKey) buf = decryptMp4(buf, contentKey);

    report("Remuxing to FLAC", 88);
    const flac: Uint8Array<ArrayBuffer> = remuxFlac(buf);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(flac);
        controller.close();
      },
    });
  }

  /**
   * Segmented DASH: decrypt and remux each segment as it arrives, so peak
   * memory stays at a few segments rather than the whole track.
   */
  async #segmentedStream(
    representation: DashRepresentation,
    init: Uint8Array,
    contentKey: string | null,
    report: (stage: string, percent: number) => void,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const urls = segmentUrls(representation);
    if (urls.length === 0) throw new Error("Amazon representation listed no segments");
    log.info(`Amazon DASH: ${urls.length} segment(s)`);

    // Preparing the init segment retypes the protected sample entry, which the
    // remuxer needs in order to find the dfLa box.
    const decryptor = contentKey ? createSegmentDecryptor(init, contentKey) : null;
    const preparedInit = decryptor?.init ?? init;

    async function* segments(): AsyncGenerator<Uint8Array> {
      const fetchSegment = async (url: string): Promise<Uint8Array> => {
        const res = await request(url, { timeoutMs: 30_000, retries: 2, signal });
        if (!res.ok) throw new Error(`Amazon segment returned HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };

      const queue: Array<Promise<Uint8Array>> = [];
      let next = 0;
      while (next < urls.length && queue.length < SEGMENT_PREFETCH) {
        queue.push(fetchSegment(urls[next++]!));
      }

      let delivered = 0;
      while (queue.length > 0) {
        const raw = await queue.shift()!;
        if (next < urls.length) queue.push(fetchSegment(urls[next++]!));
        delivered++;
        report("Downloading Amazon Ultra HD", Math.min(95, 40 + Math.round((delivered / urls.length) * 55)));
        yield decryptor ? decryptor.decrypt(raw) : raw;
      }
    }

    return remuxFlacSegments(preparedInit, segments());
  }

  async #fetchCover(url: string | undefined, signal?: AbortSignal): Promise<FlacPicture | undefined> {
    if (!url) return undefined;
    try {
      const res = await request(url, { timeoutMs: 12_000, retries: 1, signal });
      if (!res.ok) return undefined;
      const data = new Uint8Array(await res.arrayBuffer());
      return data.length > 0 ? makePicture(data, { url }) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Prefer original-cased names; fall back to the normalized ones. */
function display(track: EngineSearchResult): string[] {
  return track.artistNames?.length ? track.artistNames : track.artists;
}

function buildTags(track: EngineSearchResult, representation: DashRepresentation): FlacTags {
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
    SOURCE: "Amazon Music",
  };
  if (track.year) {
    tags.DATE = String(track.year);
    tags.YEAR = String(track.year);
  }
  if (representation.audioSamplingRate) {
    tags.QUALITY = `${(representation.audioSamplingRate / 1000).toFixed(1)} kHz`;
  }
  return tags;
}

export { AmazonAPI, AmazonAuth };
