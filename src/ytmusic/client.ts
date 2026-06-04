// InnerTube HTTP transport — pure-Node port of OuterTune's
// `innertube/src/main/java/com/zionhuang/innertube/InnerTube.kt`.
//
// Posts JSON bodies to `https://music.youtube.com/youtubei/v1/{endpoint}`
// with a per-client `context` block + the right `X-YouTube-Client-*`
// headers. Auth via SAPISIDHASH from a logged-in cookie is supported
// but optional — anonymous calls work fine for public catalog +
// search; only library / like / playlist-edit operations need login.
//
// Why a pure-Node port (no Python sidecar): the OuterTune InnerTube
// module is ~250 lines of HTTP plumbing. ytmusicapi (Python) is a
// wrapper over the same endpoints; adding a Python sidecar just for
// it would mean a second container + a sidecar tax for what is
// essentially HTTP POST. The /player endpoint (where stream URL
// signing happens) is handled by picking the IOS / ANDROID client
// type — those return unsigned URLs ready to play, so we skip JS
// deciphering entirely.

import crypto from 'node:crypto';

import { YT_CLIENTS, type YouTubeClient } from './types';

const ORIGIN = 'https://music.youtube.com';
const REFERER = `${ORIGIN}/`;
const BASE_URL = `${ORIGIN}/youtubei/v1/`;

/** Optional persistent cookie + visitor data — set via `setAuth()`.
 *  Anonymous requests work for everything we need in Phase 1 (search
 *  + player). When/if we add library/like/playlist-edit operations we
 *  hydrate these from env vars and pass `setLogin = true` per call. */
let cookie: string | null = null;
let cookieMap: Record<string, string> = {};
let visitorData: string | null = null;

const DEFAULT_LOCALE = { gl: 'IN', hl: 'en' };

const DEFAULT_TIMEOUT_MS = 20_000;

interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** Build the `context` block YouTube wants on every InnerTube request.
 *  Mirrors OuterTune's `YouTubeClient.toContext(...)`. */
function buildContext(client: YouTubeClient, locale = DEFAULT_LOCALE) {
  return {
    client: {
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      osVersion: client.osVersion,
      gl: locale.gl,
      hl: locale.hl,
      visitorData: visitorData ?? undefined,
    },
    user: { lockedSafetyMode: false },
  };
}

/** SAPISIDHASH auth — required when `setLogin: true`. Cookie comes
 *  from a logged-in browser session; the hash binds it to the
 *  YouTube Music origin + the current epoch. */
function sapisidAuthHeader(): string | null {
  const sapisid = cookieMap['SAPISID'] ?? cookieMap['__Secure-3PAPISID'];
  if (!sapisid) return null;
  const t = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${t} ${sapisid} ${ORIGIN}`).digest('hex');
  return `SAPISIDHASH ${t}_${hash}`;
}

function buildHeaders(client: YouTubeClient, setLogin: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-goog-api-format-version': '1',
    'x-youtube-client-name': client.clientId,
    'x-youtube-client-version': client.clientVersion,
    'x-origin': ORIGIN,
    referer: REFERER,
    'user-agent': client.userAgent,
    'accept-language': 'en-US,en;q=0.9',
  };
  if (setLogin && cookie) {
    headers.cookie = cookie;
    const auth = sapisidAuthHeader();
    if (auth) headers.authorization = auth;
  }
  return headers;
}

/** Generic POST against any /youtubei/v1/<endpoint> path. Returns a
 *  typed envelope rather than throwing — controllers up the stack
 *  call this in cache-fallback paths where a failed upstream should
 *  degrade gracefully (cache miss → upstream blip → empty section
 *  vs. 500 to the client). */
async function ytPost<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  client: YouTubeClient,
  opts: { setLogin?: boolean; timeoutMs?: number } = {},
): Promise<FetchResult<T>> {
  const url = `${BASE_URL}${endpoint}?prettyPrint=false`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(client, opts.setLogin === true),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `upstream ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: null, error: msg };
  } finally {
    clearTimeout(t);
  }
}

// ── High-level endpoint wrappers ─────────────────────────────────────────
//
// Each maps to one InnerTube path. The body shapes mirror the
// minimum YouTube accepts; extra fields are tolerated. We hardcode
// the client per call site rather than threading a parameter — the
// right client to use is endpoint-specific (WEB_REMIX for metadata,
// IOS for /player).

/** `/search` — query + optional filter params. The `params` blob is
 *  what YouTube uses to scope the search to a specific result type
 *  (songs / videos / albums / artists / playlists). Hardcoded
 *  values below; sourced from inspecting WEB_REMIX requests. */
export const SEARCH_FILTERS = {
  /** All result types mixed — same as the YT Music search bar. */
  all: undefined,
  songs: 'EgWKAQIIAWoQEAMQBBAJEA4QChAFEBUQEA%3D%3D',
  videos: 'EgWKAQIQAWoQEAMQBBAJEA4QChAFEBUQEA%3D%3D',
  albums: 'EgWKAQIYAWoQEAMQBBAJEA4QChAFEBUQEA%3D%3D',
  artists: 'EgWKAQIgAWoQEAMQBBAJEA4QChAFEBUQEA%3D%3D',
  playlists: 'EgWKAQIoAWoQEAMQBBAJEA4QChAFEBUQEA%3D%3D',
} as const;
export type SearchFilter = keyof typeof SEARCH_FILTERS;

export async function search(query: string, filter: SearchFilter = 'songs') {
  return ytPost(
    'search',
    {
      context: buildContext(YT_CLIENTS.WEB_REMIX),
      query,
      params: SEARCH_FILTERS[filter],
    },
    YT_CLIENTS.WEB_REMIX,
  );
}

/** `/player` — track playability + stream URLs. We default to
 *  ANDROID because it returns the richer adaptive-format set
 *  (m4a 128 + Opus 160 + various lower variants), where IOS tops out
 *  at m4a 128 kbps. Both clients' URLs are server-signed but JS-free —
 *  no on-device deciphering. If ANDROID gets rate-limited in a region,
 *  IOS is the next fallback. */
export async function player(videoId: string, client: YouTubeClient = YT_CLIENTS.ANDROID) {
  return ytPost(
    'player',
    {
      context: buildContext(client),
      videoId,
      // Marketing app-style fields some clients require for stream
      // access on premium / age-restricted content.
      contentCheckOk: true,
      racyCheckOk: true,
    },
    client,
  );
}

/** `/browse` — generic browse endpoint covering album / playlist /
 *  artist / home / explore / library. Kept for Phase 2; not yet
 *  consumed in Phase 1 controllers. */
export async function browse(browseId: string, params?: string) {
  return ytPost(
    'browse',
    {
      context: buildContext(YT_CLIENTS.WEB_REMIX),
      browseId,
      params,
    },
    YT_CLIENTS.WEB_REMIX,
  );
}

/** Hydrate the module-level cookie + visitor data. Called from
 *  startup when a YouTube Music cookie is provided via env var.
 *  Anonymous mode is the default; only invoke this to unlock
 *  library / like / playlist-edit endpoints. */
export function setAuth(opts: { cookie?: string; visitorData?: string }) {
  cookie = opts.cookie ?? null;
  visitorData = opts.visitorData ?? null;
  cookieMap = {};
  if (cookie) {
    for (const part of cookie.split(/;\s*/)) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      cookieMap[part.slice(0, i)] = part.slice(i + 1);
    }
  }
}
