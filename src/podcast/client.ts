// PodcastIndex.org HTTP client.
//
// Auth model (per https://podcastindex-org.github.io/docs-api/#auth):
//   - 4 headers per request: User-Agent, X-Auth-Date, X-Auth-Key, Authorization.
//   - Authorization = sha1(apiKey + apiSecret + unixTime) as LOWERCASE HEX.
//     This is NOT real HMAC-SHA1 despite the name in some examples — it's
//     just a plain SHA-1 of the concatenated string. Don't reach for the
//     `crypto.createHmac` API; `createHash('sha1')` is what we want.
//   - X-Auth-Date carries the same unix-seconds timestamp.
//   - User-Agent is required (server rejects requests without one).
//
// The secret never leaves this file. Controllers call `podcastIndexFetch`
// with a path + params and get back the parsed JSON envelope; everything
// upstream sees only the unified response shape via `sendSuccess` / `sendError`.

import { createHash } from 'crypto';

const BASE_URL = 'https://api.podcastindex.org/api/1.0';
const USER_AGENT = 'sunoh-api/1.0 (+https://sunoh.online)';

interface PodcastIndexResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

function readCreds(): { key: string; secret: string } | null {
  const key = process.env.PODCASTINDEX_KEY;
  const secret = process.env.PODCASTINDEX_SECRET;
  if (!key || !secret) return null;
  return { key, secret };
}

function buildAuthHeaders(): Record<string, string> | null {
  const creds = readCreds();
  if (!creds) return null;
  // Unix seconds. PodcastIndex tolerates a small skew but anything
  // beyond a couple of minutes off rejects with 401.
  const unixTime = Math.floor(Date.now() / 1000).toString();
  const authToken = createHash('sha1')
    .update(creds.key + creds.secret + unixTime)
    .digest('hex'); // lowercase by default
  return {
    'User-Agent': USER_AGENT,
    'X-Auth-Date': unixTime,
    'X-Auth-Key': creds.key,
    Authorization: authToken,
  };
}

/**
 * GET request to PodcastIndex with the standard 4-header auth. Returns a
 * normalised `{ok, status, data, error}` envelope so callers don't need
 * to unwrap fetch.Response or worry about thrown DNS errors.
 *
 * `params` is appended as a query string; null/undefined values are
 * dropped so optional filters can be passed without conditional spreads
 * at each call site.
 */
export async function podcastIndexFetch<T = any>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<PodcastIndexResult<T>> {
  const headers = buildAuthHeaders();
  if (!headers) {
    return {
      ok: false,
      status: 0,
      error:
        'PODCASTINDEX_KEY / PODCASTINDEX_SECRET not configured. ' +
        'Set them in .env.development (dev) or the prod env.',
    };
  }
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const body = await res.text();
    let parsed: any;
    try {
      parsed = body.length ? JSON.parse(body) : null;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: `Non-JSON response (status ${res.status}): ${body.slice(0, 200)}`,
      };
    }
    if (!res.ok) {
      // PodcastIndex returns `{status: 'true' | 'false', description: ...}`
      // on errors — surface its description when present.
      const desc = parsed?.description || parsed?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: desc, data: parsed };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      error: `network: ${e?.message || e}`,
    };
  }
}

/**
 * Convenience: returns true when the env has both creds. Used by
 * controllers to short-circuit with a clear 503 instead of a confusing
 * 401 from upstream when the operator just forgot to wire .env.
 */
export function podcastIndexConfigured(): boolean {
  return readCreds() !== null;
}
