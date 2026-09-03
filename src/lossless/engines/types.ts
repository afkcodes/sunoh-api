import type { EngineName, EngineSearchResult } from "../types";
import type { FlacTags } from "../lib/flac";

export interface StreamInfo {
  url: string;
  /** "flac" for lossless, "mp3" otherwise. */
  format: string;
  formatId?: number;
  mimeType: string;
  bitDepth?: number;
  samplingRateHz?: number;
  lossless: boolean;
}

export type ProgressFn = (stage: string, percent: number) => void;

export interface DownloadRequest {
  /** Track id, URL, or free text to resolve. */
  input: string;
  quality?: string;
  /** Metadata the caller already has, used to disambiguate a text search. */
  hint?: Partial<EngineSearchResult>;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
}

export interface DownloadResult {
  /** Tagged FLAC, ready to stream to the client. */
  stream: ReadableStream<Uint8Array>;
  filename: string;
  mimeType: string;
  /** Present when the upstream declared a Content-Length. */
  sizeBytes?: number;
  track: EngineSearchResult;
  tags: FlacTags;
}

/** What every lossless engine must provide. */
export interface LosslessEngine {
  readonly name: EngineName;
  /** False when credentials are missing, so the router can skip it cleanly. */
  isConfigured(): boolean;
  search(query: string, limit?: number, signal?: AbortSignal): Promise<EngineSearchResult[]>;
  /** Optional fast path when an ISRC is known. */
  searchByIsrc?(isrc: string, signal?: AbortSignal): Promise<EngineSearchResult[]>;
  getTrack(id: string, signal?: AbortSignal): Promise<EngineSearchResult | null>;
  getStream(id: string, quality?: string, signal?: AbortSignal): Promise<StreamInfo>;
  download(req: DownloadRequest): Promise<DownloadResult>;
}

/** Thrown when an engine simply does not carry the track. */
export class NotAvailableError extends Error {
  constructor(
    readonly engine: EngineName,
    message: string,
  ) {
    super(message);
    this.name = "NotAvailableError";
  }
}

/** Thrown when an engine has no credentials configured. */
export class NotConfiguredError extends Error {
  constructor(
    readonly engine: EngineName,
    message?: string,
  ) {
    super(message ?? `The ${engine} engine is not configured.`);
    this.name = "NotConfiguredError";
  }
}
