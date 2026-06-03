// HTTP plumbing for the cozyaudiobooks.com integration.
//
// Two surfaces:
//   - The standard WordPress REST API at `/wp-json/wp/v2/*` (JSON,
//     paginated, well-behaved).
//   - The custom `/wp-admin/admin-ajax.php?action=cozy_search` handler
//     (JSON array, no pagination, returns rich rows with cover+author).
//
// Both go through plain fetch with a desktop UA — cozyaudiobooks's WAF
// blocks Node's default user-agent and ffmpeg-style strings.

const BASE = 'https://cozyaudiobooks.com';
/** Same Chrome UA the radio + Shazam paths use. The site bot-blocks
 *  the default Node fetch UA. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 20_000;

interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** GET a WordPress REST endpoint and parse as JSON. Returns a typed
 *  envelope rather than throwing — controllers up the stack call this
 *  in cache-fallback paths where a failed upstream should degrade
 *  gracefully (cache miss → upstream blip → empty section vs. 500). */
export async function cozyJson<T = unknown>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult<T>> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `upstream ${res.status}`,
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

/** GET a post URL and return the raw HTML — used by the scraper. We
 *  intentionally drop binary support; the page is always text/html. */
export async function cozyHtml(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult<string>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `upstream ${res.status}`,
      };
    }
    const data = await res.text();
    return { ok: true, status: res.status, data, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: null, error: msg };
  } finally {
    clearTimeout(t);
  }
}
