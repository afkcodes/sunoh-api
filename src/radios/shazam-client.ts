// HTTP client for the Python Shazam sidecar (see `shazam-sidecar/app.py`).
//
// The sidecar is reachable on the internal Docker network at
// `http://shazam:8080` (set via SHAZAM_BASE_URL in docker-compose.yml).
// Outside docker (local `npm run dev`) the env var is unset — `identify`
// short-circuits to a typed "sidecar offline" response so the worker
// can log once and skip without crashing.

const BASE_URL = process.env.SHAZAM_BASE_URL || '';

export interface ShazamTrack {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  released?: string | null;
  label?: string | null;
  image?: string | null;
  shazam_id?: string | null;
  isrc?: string | null;
  genres?: string[] | null;
  share_url?: string | null;
}

export interface IdentifyTiming {
  capture_ms?: number;
  recognize_ms?: number;
  total_ms: number;
}

export interface IdentifyResult {
  matched: boolean;
  track: ShazamTrack | null;
  timing: IdentifyTiming;
  error: string | null;
}

interface IdentifyOptions {
  /** Audio sample length in seconds. shazamio matches reliably on 5s+. */
  seconds?: number;
  /** Hard timeout for the whole identify call (sidecar enforces too). */
  timeoutMs?: number;
  /** Spoof a Chrome UA/Referer when ffmpeg connects to the stream. */
  useHeaders?: boolean;
}

export function isShazamConfigured(): boolean {
  return Boolean(BASE_URL);
}

/**
 * Call the sidecar to identify the current track on `streamUrl`. The
 * sidecar captures `seconds` of audio with ffmpeg + runs shazamio.
 *
 * Network errors / non-2xx responses come back as `{ matched: false,
 * track: null, error: '…' }` rather than throwing — the worker calls
 * this in a tight loop and rejection paths complicate the loop.
 */
export async function identify(
  streamUrl: string,
  opts: IdentifyOptions = {},
): Promise<IdentifyResult> {
  if (!BASE_URL) {
    return {
      matched: false,
      track: null,
      timing: { total_ms: 0 },
      error: 'SHAZAM_BASE_URL not set — sidecar disabled',
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${BASE_URL}/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: streamUrl,
        seconds: opts.seconds ?? 5,
        // The sidecar caps internally to a sane range; mirror it.
        timeout: Math.min(60, Math.max(5, Math.floor((opts.timeoutMs ?? 30_000) / 1000))),
        use_headers: opts.useHeaders ?? true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        matched: false,
        track: null,
        timing: { total_ms: 0 },
        error: `sidecar ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return (await res.json()) as IdentifyResult;
  } catch (e: any) {
    return {
      matched: false,
      track: null,
      timing: { total_ms: 0 },
      error:
        e?.name === 'AbortError'
          ? 'sidecar request timed out'
          : `sidecar error: ${e?.message ?? e}`,
    };
  } finally {
    clearTimeout(t);
  }
}
