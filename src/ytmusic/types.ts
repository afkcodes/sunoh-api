// Minimal InnerTube request/response shapes.
//
// YouTube's private API is enormous — we only model the slice we
// actually consume in mappers.ts. Unknown fields are tolerated (the
// HTTP client doesn't validate; mappers do `?` null-safe field reads
// and quietly drop renderers they don't recognise).

/** One of YouTube's hard-coded `INNERTUBE_CONTEXT.client` profiles.
 *  Each profile maps to a real client app (web / iOS / Android / TV)
 *  and influences which response shapes + stream URL formats come
 *  back. Most-important consequence: WEB_REMIX (the YouTube Music web
 *  client) returns stream URLs with a `signatureCipher` that needs
 *  JS deciphering; IOS / ANDROID return unsigned URLs ready to play.
 *
 *  Sourced from OuterTune's models/YouTubeClient.kt, trimmed to the
 *  three we actually use. */
export interface YouTubeClient {
  clientName: string;
  clientVersion: string;
  clientId: string;
  userAgent: string;
  osVersion?: string;
  /** When true, `/player` requests for this client return unsigned
   *  stream URLs — i.e. we can play them without a JS deciphering
   *  step. IOS + ANDROID set this; WEB_REMIX does not. */
  preferredForStreams?: boolean;
}

export const YT_CLIENTS = {
  /** YouTube Music web client. Best for metadata (search / browse /
   *  album / artist / playlist) — its response shapes are the
   *  richest and the renderer set we model in mappers.ts targets it. */
  WEB_REMIX: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250310.01.00',
    clientId: '67',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  },
  /** iOS YouTube client. Used ONLY for /player calls to skip the
   *  signature-deciphering treadmill — stream URLs come back ready
   *  to play. As of late 2025 still mostly PO-Token-free. */
  IOS: {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    clientId: '5',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    osVersion: '18.3.2.22D82',
    preferredForStreams: true,
  },
  /** Android YouTube client. Fallback for IOS when YT throttles
   *  Apple-UA traffic in a given region. Same "unsigned URL"
   *  property as IOS. */
  ANDROID: {
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    clientId: '3',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 14)',
    osVersion: '14',
    preferredForStreams: true,
  },
} as const satisfies Record<string, YouTubeClient>;

/** One thumbnail variant the InnerTube responses ship — sorted
 *  smallest → largest in the upstream JSON. */
export interface YtThumbnail {
  url: string;
  width: number;
  height: number;
}

/** Free-form "run" segment — a chunk of text optionally pointing at
 *  another browse target. Used as building block in titles, artist
 *  names, breadcrumbs, etc. */
export interface YtRun {
  text: string;
  navigationEndpoint?: {
    browseEndpoint?: { browseId: string; browseEndpointContextSupportedConfigs?: unknown };
    watchEndpoint?: { videoId?: string; playlistId?: string; params?: string };
  };
}

/** Generic InnerTube envelope — wraps every endpoint response. We
 *  only ever read into `contents` / `onResponseReceivedActions`
 *  and trust the renderer dispatch in mappers.ts. */
export interface InnerTubeResponse {
  contents?: unknown;
  onResponseReceivedCommands?: unknown[];
  onResponseReceivedActions?: unknown[];
  continuationContents?: unknown;
  header?: unknown;
}

/** Audio format from /player → streamingData.adaptiveFormats[]. */
export interface YtAdaptiveFormat {
  itag: number;
  url?: string;
  /** Present only on WEB clients — needs JS-deciphering to convert
   *  into `url`. We avoid this by using IOS/ANDROID for /player. */
  signatureCipher?: string;
  mimeType: string;
  bitrate: number;
  averageBitrate?: number;
  contentLength?: string;
  approxDurationMs?: string;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
}

/** Subset of the /player response we read. */
export interface YtPlayerResponse {
  playabilityStatus?: {
    status: string; // OK | UNPLAYABLE | LOGIN_REQUIRED | ERROR
    reason?: string;
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    author: string;
    channelId: string;
    thumbnail?: { thumbnails: YtThumbnail[] };
  };
  streamingData?: {
    expiresInSeconds?: string;
    formats?: YtAdaptiveFormat[];
    adaptiveFormats?: YtAdaptiveFormat[];
    hlsManifestUrl?: string;
  };
}
