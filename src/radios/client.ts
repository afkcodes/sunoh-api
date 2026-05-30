// Thin HTTP wrapper for the sunoh-radio upstream service.
//
// The upstream lives at SUNOH_RADIO_BASE_URL (default
// http://localhost:4000 — same on local dev + on the VPS, where the
// radio service runs in the same docker network as this API). All
// endpoints are public + cacheable; no auth header to forward.
//
// Returns the same `{ok, status, data}` envelope used elsewhere
// (`podcastIndexFetch`'s shape) so call sites stay symmetric.

const DEFAULT_BASE_URL = 'http://localhost:4000';
const USER_AGENT = 'sunoh-api/1.0 (+https://sunoh.online)';

function baseUrl(): string {
  return (process.env.SUNOH_RADIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

interface RadioFetchResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function sunohRadioFetch<T = unknown>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<RadioFetchResult<T>> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = qs ? `${baseUrl()}${path}?${qs}` : `${baseUrl()}${path}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
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
      const desc = parsed?.error || parsed?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: desc, data: parsed };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (e: any) {
    return { ok: false, status: 0, error: `network: ${e?.message || e}` };
  }
}
