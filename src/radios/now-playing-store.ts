// Redis-backed state for the listener-driven now-playing flow.
//
// Two key shapes:
//
//   `radio:hot` (ZSET)
//     One entry per slug being listened to right now. Score = epoch
//     seconds at which the entry expires (we don't trust Redis's
//     per-element TTL since ZSETs don't have one — manual cleanup
//     instead). Touched on every `/radios/:slug/now-playing` poll
//     from Flutter; the worker walks this set to decide what to
//     fingerprint.
//
//   `radio:np:<slug>` (string → JSON)
//     The last result the worker computed for this slug — matched
//     track + when it was checked + when to recheck. 10-min TTL so
//     entries clean themselves up after a station goes idle. Read
//     by the public `/now-playing` endpoint.
//
// Helpers in this file abstract those keys so the worker + controller
// don't sprinkle ZADD/ZRANGEBYSCORE everywhere. All return `null` /
// no-op silently when Redis is unavailable (dev mode); callers don't
// need to special-case that.

import { cache } from '../redis';
import type { ShazamTrack } from './shazam-client';

const HOT_KEY = 'radio:hot';
const RESULT_KEY = (slug: string) => `radio:np:${slug}`;

/** TTL on a "currently listening" entry. Refreshed on every Flutter
 *  poll, so as long as polls keep arriving every <30 s the slug stays
 *  hot. Drop below 30 s and a single dropped poll boots the station
 *  out of the rotation. Raise above and the worker keeps fingerprinting
 *  for too long after the user pauses. 30 s is a comfortable middle. */
const HOT_TTL_SECONDS = 30;

/** TTL on stored results. The endpoint serves whatever's here, so this
 *  bounds how long a stale "last known track" can leak after a station
 *  goes idle. 10 minutes is long enough that re-opening a station feels
 *  instant, short enough that yesterday's match never resurfaces. */
const RESULT_TTL_SECONDS = 600;

export interface StoredNowPlaying {
  /** Whether the last fingerprint matched a track. */
  matched: boolean;
  /** Matched track metadata. Null when matched=false. */
  track: ShazamTrack | null;
  /** Epoch seconds when the fingerprint ran. */
  checkedAt: number;
  /** Epoch seconds when the worker should refresh this slug. */
  nextCheckAt: number;
  /** Consecutive no-match runs — drives the back-off schedule. */
  missCount: number;
  /** Last error from the sidecar, if any (ffmpeg / network / etc.). */
  lastError?: string | null;
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/** Mark `slug` as actively being listened to — extends its expiry by
 *  HOT_TTL_SECONDS from now. Idempotent: repeated calls just push the
 *  expiry score forward. Called from the `/now-playing` controller on
 *  every Flutter poll. */
export async function touchHot(slug: string): Promise<void> {
  const r = cache.getClient();
  if (!r) return;
  try {
    await r.zadd(HOT_KEY, nowEpoch() + HOT_TTL_SECONDS, slug);
  } catch (e) {
    // Soft-fail: a missed touch just means the slug ages out a poll
    // sooner; the next poll re-extends it. No user-visible impact.
    console.error('[now-playing] touchHot failed', e);
  }
}

/** Active slugs being listened to right now. The worker loops over
 *  these to decide what to fingerprint. Also strips expired entries
 *  before reading — keeps the set bounded without a separate cleanup
 *  cron. */
export async function activeSlugs(): Promise<string[]> {
  const r = cache.getClient();
  if (!r) return [];
  try {
    const now = nowEpoch();
    // Drop entries whose expiry score is in the past, in one atomic
    // command (cheaper than ZRANGEBYSCORE-then-filter in Node).
    await r.zremrangebyscore(HOT_KEY, '-inf', now);
    return await r.zrange(HOT_KEY, 0, -1);
  } catch (e) {
    console.error('[now-playing] activeSlugs failed', e);
    return [];
  }
}

/** Read the worker's last result for `slug`. Null = worker hasn't
 *  processed this slug yet (returns `pending` to the client). */
export async function getResult(slug: string): Promise<StoredNowPlaying | null> {
  return cache.get<StoredNowPlaying>(RESULT_KEY(slug));
}

/** Write the worker's result for `slug`. Uses the shared cache wrapper
 *  so the TTL is enforced consistently. */
export async function setResult(slug: string, value: StoredNowPlaying): Promise<void> {
  await cache.set(RESULT_KEY(slug), value, RESULT_TTL_SECONDS);
}

/** Compute when to next fingerprint `slug` given the latest result.
 *
 *  Matched: recheck in 30 s. This is conservative — a future iteration
 *  can read the Shazam-returned offset+duration to schedule the next
 *  check right before the track ends, but for v1 a flat 30 s is plenty
 *  (most tracks are 3+ min long, so we'd often re-fingerprint mid-song
 *  and get the same match; cheap and predictable).
 *
 *  No match: exponential-ish back-off (15 → 30 → 60 → 90 → 90) to keep
 *  Shazam load reasonable for talk/news stations that never produce a
 *  match. The cap is intentional — we still want to check occasionally
 *  in case the station transitions into music. */
export function computeNextCheck(opts: {
  matched: boolean;
  missCount: number;
  now: number;
}): number {
  if (opts.matched) return opts.now + 30;
  const backoff = [15, 30, 60, 90][Math.min(opts.missCount, 3)] ?? 90;
  return opts.now + backoff;
}

/** Convenience constructor for the controller's "pending" response. */
export function pendingResult(): StoredNowPlaying {
  const t = nowEpoch();
  return {
    matched: false,
    track: null,
    checkedAt: t,
    nextCheckAt: t,
    missCount: 0,
  };
}
