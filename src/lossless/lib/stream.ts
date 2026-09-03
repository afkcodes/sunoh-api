import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Stream helpers shared by the download paths. */

/**
 * Write a ReadableStream to disk incrementally.
 *
 * The pipeline runs through node:stream so backpressure is honoured: a slow
 * disk throttles the download rather than buffering a hi-res track in memory.
 * Returns the number of bytes written.
 */
export async function writeStreamToFile(
  stream: ReadableStream<Uint8Array>,
  path: string,
  onProgress?: (bytesWritten: number) => void,
): Promise<number> {
  let written = 0;
  const counted = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.length;
        onProgress?.(written);
        controller.enqueue(chunk);
      },
    }),
  );

  await pipeline(Readable.fromWeb(counted as never), createWriteStream(path));
  return written;
}

/** Collect a stream into a single Uint8Array. Only for small payloads. */
export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

/**
 * Wrap a stream so byte progress is reported as it flows, without buffering.
 * `total` may be undefined when the server sends no Content-Length.
 */
export function withProgress(
  stream: ReadableStream<Uint8Array>,
  total: number | undefined,
  onProgress: (bytes: number, total: number | undefined) => void,
): ReadableStream<Uint8Array> {
  let seen = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.length;
        onProgress(seen, total);
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Concatenate several streams into one, in order. */
export function concatStreams(
  sources: readonly (() => Promise<ReadableStream<Uint8Array>>)[],
): ReadableStream<Uint8Array> {
  // Inferred rather than annotated: the global and node:stream/web reader types
  // differ subtly, and naming either one here produces a spurious mismatch.
  const openReader = async (index: number) => (await sources[index]!()).getReader();
  type Reader = Awaited<ReturnType<typeof openReader>>;

  let index = 0;
  let current: Reader | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!current) {
          if (index >= sources.length) {
            controller.close();
            return;
          }
          current = await openReader(index++);
        }
        // Local binding: `current` is nulled below, and the awaits above defeat
        // narrowing on the field itself.
        const reader: Reader = current;
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          current = null;
          continue;
        }
        if (value && value.byteLength > 0) {
          controller.enqueue(value as Uint8Array);
          return;
        }
      }
    },
    async cancel(reason) {
      await current?.cancel(reason);
    },
  });
}
