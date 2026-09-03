/**
 * Fragmented-MP4 to native FLAC remux, replacing the ffmpeg subprocess.
 *
 * Tidal's Hi-Res streams and Amazon's Ultra HD streams both deliver FLAC frames
 * packed inside an fMP4 container. The frames are already FLAC, so no decoding
 * or re-encoding is involved: the `dfLa` box holds the FLAC metadata blocks and
 * each MP4 sample is exactly one coded FLAC frame. Lifting the metadata out and
 * concatenating the samples produces a byte-identical, bit-perfect FLAC file.
 *
 * Ported from amzdl/remux/remux.py.
 */

import { FLAC_MAGIC } from "./flac";
import { findCodecBox, findBox, iterSamples, Mp4Error, type Box } from "./mp4";

const STREAMINFO = 0;

export class RemuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemuxError";
  }
}

/**
 * Re-serialise the metadata blocks from a `dfLa` box, fixing the last-block
 * flag. The dfLa payload is a bare block sequence whose flags are not
 * necessarily correct once lifted out of the container.
 */
export function normalizeMetadata(blocks: Uint8Array): Uint8Array<ArrayBuffer> {
  const parsed: Array<{ type: number; data: Uint8Array }> = [];
  let offset = 0;

  while (offset + 4 <= blocks.length) {
    const type = blocks[offset]! & 0x7f;
    const length = (blocks[offset + 1]! << 16) | (blocks[offset + 2]! << 8) | blocks[offset + 3]!;
    parsed.push({ type, data: blocks.subarray(offset + 4, offset + 4 + length) });
    offset += 4 + length;
  }

  if (parsed.length === 0 || parsed[0]!.type !== STREAMINFO) {
    throw new RemuxError("dfLa box is missing STREAMINFO");
  }

  let total = 0;
  for (const block of parsed) total += 4 + block.data.length;

  const out = new Uint8Array(total);
  let cursor = 0;
  parsed.forEach((block, index) => {
    const last = index === parsed.length - 1 ? 0x80 : 0x00;
    out[cursor] = last | block.type;
    out[cursor + 1] = (block.data.length >>> 16) & 0xff;
    out[cursor + 2] = (block.data.length >>> 8) & 0xff;
    out[cursor + 3] = block.data.length & 0xff;
    out.set(block.data, cursor + 4);
    cursor += 4 + block.data.length;
  });
  return out;
}

/** Locate the moov box, raising a clear error when the input is not an MP4. */
function requireMoov(buf: Uint8Array): Box {
  const moov = findBox(buf, 0, buf.length, "moov");
  if (!moov) throw new RemuxError("no moov box found (input is not a fragmented MP4)");
  return moov;
}

/** Extract the FLAC metadata section from a fragmented MP4's dfLa box. */
export function extractFlacHeader(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  const moov = requireMoov(buf);
  let dfla: Box | null;
  try {
    dfla = findCodecBox(buf, moov.contentStart, moov.end, "dfLa");
  } catch (err) {
    throw err instanceof Mp4Error ? new RemuxError(err.message) : err;
  }
  if (!dfla) throw new RemuxError("no dfLa box found (the track is not FLAC)");

  // dfLa is a FullBox: skip its 4-byte version/flags before the block list.
  return normalizeMetadata(buf.subarray(dfla.contentStart + 4, dfla.end));
}

/**
 * Remux a complete in-memory fragmented MP4 into a FLAC file.
 * Returns "fLaC" + metadata blocks + every coded frame, in order.
 */
export function remuxFlac(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = extractFlacHeader(buf);

  const samples = [...iterSamples(buf, buf.length)];
  if (samples.length === 0) throw new RemuxError("no audio samples found");

  let audioBytes = 0;
  for (const sample of samples) audioBytes += sample.size;

  const out = new Uint8Array(FLAC_MAGIC.length + header.length + audioBytes);
  let cursor = 0;
  out.set(FLAC_MAGIC, cursor);
  cursor += FLAC_MAGIC.length;
  out.set(header, cursor);
  cursor += header.length;

  for (const sample of samples) {
    out.set(buf.subarray(sample.offset, sample.offset + sample.size), cursor);
    cursor += sample.size;
  }
  return out;
}

/**
 * Streaming remux for DASH, where the initialisation segment carries the moov
 * (and therefore the dfLa) and each media segment carries moof/mdat pairs.
 *
 * The header is emitted once from the init segment, then every media segment is
 * reduced to its raw FLAC frames. Only one segment is ever held in memory.
 */
export function remuxFlacSegments(
  initSegment: Uint8Array,
  mediaSegments: AsyncIterable<Uint8Array>,
): ReadableStream<Uint8Array> {
  const header = extractFlacHeader(initSegment);
  let emittedHeader = false;
  let sawSamples = false;
  let iterator: AsyncIterator<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!emittedHeader) {
        emittedHeader = true;
        const start = new Uint8Array(FLAC_MAGIC.length + header.length);
        start.set(FLAC_MAGIC, 0);
        start.set(header, FLAC_MAGIC.length);
        controller.enqueue(start);
        // The init segment can itself carry a first moof/mdat pair.
        const initFrames = extractFrames(initSegment);
        if (initFrames.length > 0) {
          sawSamples = true;
          controller.enqueue(initFrames);
        }
        return;
      }

      iterator ??= mediaSegments[Symbol.asyncIterator]();
      for (;;) {
        const { done, value } = await iterator.next();
        if (done) {
          if (!sawSamples) {
            controller.error(new RemuxError("no audio samples found in any segment"));
            return;
          }
          controller.close();
          return;
        }
        if (!value?.length) continue;
        const frames = extractFrames(value);
        if (frames.length === 0) continue;
        sawSamples = true;
        controller.enqueue(frames);
        return;
      }
    },
    async cancel(reason) {
      await iterator?.return?.(reason);
    },
  });
}

/** Concatenate every sample payload in one fMP4 segment. */
export function extractFrames(segment: Uint8Array): Uint8Array<ArrayBuffer> {
  const samples = [...iterSamples(segment, segment.length)];
  if (samples.length === 0) return new Uint8Array(0);

  let total = 0;
  for (const sample of samples) total += sample.size;

  const out = new Uint8Array(total);
  let cursor = 0;
  for (const sample of samples) {
    out.set(segment.subarray(sample.offset, sample.offset + sample.size), cursor);
    cursor += sample.size;
  }
  return out;
}
