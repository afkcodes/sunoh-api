// Background worker that drives the listener-driven now-playing flow.
//
// Loop, every TICK_MS:
//   1. Read active slugs from Redis (`radio:hot` — populated by the
//      Flutter client's polling).
//   2. For each, check the stored result's `nextCheckAt`. If due:
//      - Fetch the station's `stream_url` from sunoh-radio (cached
//        24 h, so this is essentially free).
//      - Hand it to the Shazam sidecar via `identify(stream_url)`.
//      - Store the result with a back-off-aware `nextCheckAt`.
//   3. Sleep, repeat.
//
// The loop is single-threaded — at any moment we're processing at most
// one slug. For a private 2-user app this is fine (peak active slugs ≈
// 2, fingerprints take ~3 s). When/if concurrent listeners explode,
// switch the per-tick loop to Promise.all-with-cap.

import { sunohRadioFetch } from './client';
import {
  activeSlugs,
  computeNextCheck,
  getResult,
  setResult,
  type StoredNowPlaying,
} from './now-playing-store';
import { identify, isShazamConfigured } from './shazam-client';
import type { RadioStationUpstream } from './types';

/** How often to wake up and check for due slugs. Doesn't drive
 *  per-station cadence (that's `computeNextCheck`) — this is just the
 *  scheduling granularity. 3 s is small enough that newly-arriving
 *  listeners see a "pending" → matched transition fast, big enough
 *  that idle ticks are cheap. */
const TICK_MS = 3_000;

/** Hard timeout for a single sidecar call. Sidecar enforces its own
 *  internal timeout too, but we set this slightly larger so the
 *  sidecar's own error surfaces (typed `error: '…'` response) rather
 *  than us aborting first. */
const IDENTIFY_TIMEOUT_MS = 25_000;

let running = false;
let timer: NodeJS.Timeout | null = null;

/** Resolve a station slug → stream URL, going through sunoh-radio. The
 *  /stations/:slug endpoint already lives behind a 24 h cache (see
 *  controller.ts) so this is cheap; we don't add a second layer here. */
async function resolveStreamUrl(slug: string): Promise<string | null> {
  const upstream = await sunohRadioFetch<RadioStationUpstream>(
    `/stations/${encodeURIComponent(slug)}`,
  );
  if (!upstream.ok || !upstream.data) return null;
  return upstream.data.stream_url || null;
}

/** Process one slug — at most one sidecar call. No-ops if the slug is
 *  still cooling down per its `nextCheckAt`. */
async function processSlug(slug: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const prev = await getResult(slug);
  if (prev && prev.nextCheckAt > now) return;

  const url = await resolveStreamUrl(slug);
  if (!url) {
    // No stream URL = the slug doesn't exist upstream or sunoh-radio is
    // down. Either way we can't fingerprint. Store a long-back-off
    // result so we don't keep retrying immediately.
    const result: StoredNowPlaying = {
      matched: false,
      track: null,
      checkedAt: now,
      nextCheckAt: now + 90,
      missCount: (prev?.missCount ?? 0) + 1,
      lastError: 'no stream_url',
    };
    await setResult(slug, result);
    return;
  }

  const ident = await identify(url, {
    seconds: 5,
    timeoutMs: IDENTIFY_TIMEOUT_MS,
    useHeaders: true,
  });

  const matched = ident.matched && !!ident.track;
  const missCount = matched ? 0 : (prev?.missCount ?? 0) + 1;
  const checkedAt = Math.floor(Date.now() / 1000);

  const result: StoredNowPlaying = {
    matched,
    track: matched ? ident.track : null,
    checkedAt,
    nextCheckAt: computeNextCheck({ matched, missCount, now: checkedAt }),
    missCount,
    lastError: ident.error ?? null,
  };
  await setResult(slug, result);
}

async function tick(): Promise<void> {
  try {
    const slugs = await activeSlugs();
    if (slugs.length === 0) return;
    // Serial — bounds concurrency at 1. Shazam's unofficial API + the
    // sidecar's single-worker uvicorn don't appreciate parallel hits
    // from the same IP, and for two listeners there's nothing to gain
    // from parallelism anyway. If we ever scale up, swap for a
    // capped-concurrency pool here.
    for (const slug of slugs) {
      await processSlug(slug);
    }
  } catch (e) {
    // Catch-all so a single tick failure doesn't kill the loop.
    console.error('[now-playing-worker] tick failed', e);
  }
}

/** Start the worker loop. Idempotent — calling twice is harmless. The
 *  caller (server boot) is responsible for invoking this after Fastify
 *  is listening; the worker doesn't depend on the HTTP server but
 *  starting it before `app.listen()` would race the Redis client
 *  initialisation that lives in `redis.ts`. */
export function startNowPlayingWorker(): void {
  if (running) return;
  if (!isShazamConfigured()) {
    console.log('[now-playing-worker] SHAZAM_BASE_URL unset — worker disabled');
    return;
  }
  running = true;
  console.log(`[now-playing-worker] starting (tick=${TICK_MS}ms)`);
  // Kick off immediately so a freshly-touched slug doesn't wait a full
  // TICK_MS for its first fingerprint, then schedule the recurring run.
  const loop = async () => {
    while (running) {
      await tick();
      await new Promise((res) => setTimeout(res, TICK_MS));
    }
  };
  // Detached promise; errors handled inside `tick`.
  loop().catch((e) => console.error('[now-playing-worker] loop exited', e));
}

/** Stop the worker — used by graceful shutdown if we ever wire that up.
 *  Currently nothing calls this; included for parity with `start`. */
export function stopNowPlayingWorker(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
