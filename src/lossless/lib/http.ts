import { USER_AGENT } from "../config";

export class HttpError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions extends RequestInit {
  /** Milliseconds before the request is aborted. Default 15000. */
  timeoutMs?: number;
  /** Retry count for transient failures (429/5xx/network). Default 2. */
  retries?: number;
  /** Query parameters appended to the URL. Undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function withQuery(url: string, query?: RequestOptions["query"]): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout, retry-with-backoff and Retry-After support. */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, retries = 2, query, signal: outerSignal, ...init } = options;
  const target = withQuery(url, query);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;

    try {
      const res = await fetch(target, {
        ...init,
        signal,
        headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const retryAfter = Number.parseFloat(res.headers.get("Retry-After") ?? "");
          const waitMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(2 ** attempt * 500, 4000);
          await sleep(waitMs);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      // A caller-initiated abort is final; only retry timeouts and network errors.
      if (outerSignal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(Math.min(2 ** attempt * 400, 3000));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${target}`);
}

/** request() + JSON parse, throwing HttpError on a non-2xx. */
export async function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(`GET ${url} -> ${res.status}`, res.status, body.slice(0, 500));
  }
  return (await res.json()) as T;
}

/** getJson that resolves to null instead of throwing. For optional enrichment. */
export async function tryGetJson<T>(url: string, options: RequestOptions = {}): Promise<T | null> {
  try {
    return await getJson<T>(url, options);
  } catch {
    return null;
  }
}

/**
 * Serialises calls to a host and enforces a minimum gap between them.
 * MusicBrainz caps anonymous clients at roughly one request per second.
 */
export function createRateLimiter(minIntervalMs: number) {
  let chain: Promise<void> = Promise.resolve();
  let last = 0;

  return function limited<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    chain = run.catch(() => undefined);
    return run.then(fn);
  };
}
