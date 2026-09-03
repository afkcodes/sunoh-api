/**
 * In-memory download progress, replacing download_progress.py.
 *
 * Entries expire so a browser that abandons a download cannot leak memory.
 */

export interface ProgressEntry {
  jobId: string;
  stage: string;
  percent: number;
  error?: string;
  engine?: string;
  updatedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

const entries = new Map<string, ProgressEntry>();

export function update(
  jobId: string | undefined | null,
  stage: string,
  percent: number,
  extra: { error?: string; engine?: string } = {},
): void {
  if (!jobId) return;
  entries.set(jobId, {
    jobId,
    stage,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    error: extra.error,
    engine: extra.engine,
    updatedAt: Date.now(),
  });
}

export function get(jobId: string): ProgressEntry | null {
  return entries.get(jobId) ?? null;
}

export function remove(jobId: string | undefined | null): void {
  if (jobId) entries.delete(jobId);
}

export function size(): number {
  return entries.size;
}

/** Drop entries older than the TTL. Exported so tests can drive it directly. */
export function sweep(now = Date.now()): number {
  let removed = 0;
  for (const [id, entry] of entries) {
    if (now - entry.updatedAt > TTL_MS) {
      entries.delete(id);
      removed++;
    }
  }
  return removed;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSweeper(): void {
  if (timer) return;
  timer = setInterval(() => sweep(), SWEEP_MS);
  // Never hold the process open just to expire progress entries.
  timer.unref?.();
}

export function stopSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
