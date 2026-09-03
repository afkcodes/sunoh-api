import { config } from "../config";

/**
 * Counting semaphore. Downloads are gated so a handful of concurrent hi-res
 * transfers cannot saturate the upstream connection or the host's bandwidth.
 */
export class Semaphore {
  #active = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(readonly limit: number) {}

  get active(): number {
    return this.#active;
  }

  get waiting(): number {
    return this.#waiters.length;
  }

  /** Resolves to a release function. Calling it twice is a no-op. */
  async acquire(): Promise<() => void> {
    if (this.#active < this.limit) {
      this.#active++;
    } else {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
      this.#active++;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active--;
      this.#waiters.shift()?.();
    };
  }

  /** Run `fn` while holding a slot. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const downloadGate = new Semaphore(config.maxConcurrentDownloads);
