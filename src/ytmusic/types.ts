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
  /** Android VR (Oculus Quest) YouTube client. **The current default
   *  for /player calls.** A niche legacy client that YouTube hasn't
   *  tightened — returns unsigned stream URLs, no PoToken, no
   *  "Precondition check failed", and the URLs play without UA-bound
   *  signing constraints. Sourced from OuterTune's
   *  YTPlayerUtils.MAIN_CLIENT (see their note: "Is temporally used
   *  as it is out only working client"). When YT eventually forces
   *  PoToken here too, we'll have to either ship a PoToken
   *  generator (headless WebView) or rotate clients again. */
  ANDROID_VR_NO_AUTH: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.61.48',
    clientId: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Oculus Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
    osVersion: '12',
    preferredForStreams: true,
  },
  /** iOS YouTube client. Fallback only — recent YT changes produce
   *  403 after ~30 s of playback on iOS streams (per OuterTune's
   *  STREAM_FALLBACK_CLIENTS note), and bare requests now sometimes
   *  trip "Precondition check failed". Kept as a safety net. */
  IOS: {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    clientId: '5',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    osVersion: '18.3.2.22D82',
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
