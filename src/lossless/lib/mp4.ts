/**
 * ISOBMFF (MP4) box parsing.
 *
 * Ported from amzdl/remux/mp4.py. Shared by the FLAC remuxer and the CENC
 * decryptor, which both need to walk fragment headers and locate sample data.
 */

export const AUDIO_SAMPLE_ENTRY_HEADER = 36;

const TFHD_BASE_DATA_OFFSET = 0x000001;
const TFHD_SAMPLE_DESC_INDEX = 0x000002;
const TFHD_DEFAULT_DURATION = 0x000008;
const TFHD_DEFAULT_SIZE = 0x000010;

const TRUN_DATA_OFFSET = 0x000001;
const TRUN_FIRST_SAMPLE_FLAGS = 0x000004;
const TRUN_SAMPLE_DURATION = 0x000100;
const TRUN_SAMPLE_SIZE = 0x000200;
const TRUN_SAMPLE_FLAGS = 0x000400;
const TRUN_SAMPLE_CTO = 0x000800;

export interface Box {
  type: string;
  /** Offset of the box header. */
  start: number;
  /** Offset of the box payload, after the (8 or 16 byte) header. */
  contentStart: number;
  /** Offset one past the end of the box. */
  end: number;
}

export class Mp4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4Error";
  }
}

function fourcc(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
}

/** Walk the boxes between `start` and `end`. */
export function* iterBoxes(buf: Uint8Array, start: number, end: number): Generator<Box> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = start;

  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false);
    const type = fourcc(buf, offset + 4);
    let header = 8;

    if (size === 1) {
      // 64-bit extended size.
      if (offset + 16 > end) break;
      const big = view.getBigUint64(offset + 8, false);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      // Box runs to the end of the container.
      size = end - offset;
    }

    if (size < header || offset + size > end) break;
    yield { type, start: offset, contentStart: offset + header, end: offset + size };
    offset += size;
  }
}

export function findBox(buf: Uint8Array, start: number, end: number, target: string): Box | null {
  for (const box of iterBoxes(buf, start, end)) {
    if (box.type === target) return box;
  }
  return null;
}

/** Follow a nested path of box types, e.g. "trak" > "mdia" > "minf". */
export function findPath(
  buf: Uint8Array,
  start: number,
  end: number,
  ...path: readonly string[]
): Box | null {
  let cursor: Box = { type: "", start, contentStart: start, end };
  for (const target of path) {
    const found = findBox(buf, cursor.contentStart, cursor.end, target);
    if (!found) return null;
    cursor = found;
  }
  return cursor;
}

export interface TfhdInfo {
  baseDataOffset: number | null;
  defaultDuration: number;
  defaultSize: number;
}

export function parseTfhd(buf: Uint8Array, contentStart: number): TfhdInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Byte 0 is the version; bytes 1..3 are the flags.
  const flags = (buf[contentStart + 1]! << 16) | (buf[contentStart + 2]! << 8) | buf[contentStart + 3]!;

  let offset = contentStart + 8; // version/flags + track_ID
  let baseDataOffset: number | null = null;
  let defaultDuration = 0;
  let defaultSize = 0;

  if (flags & TFHD_BASE_DATA_OFFSET) {
    baseDataOffset = Number(view.getBigUint64(offset, false));
    offset += 8;
  }
  if (flags & TFHD_SAMPLE_DESC_INDEX) offset += 4;
  if (flags & TFHD_DEFAULT_DURATION) {
    defaultDuration = view.getUint32(offset, false);
    offset += 4;
  }
  if (flags & TFHD_DEFAULT_SIZE) {
    defaultSize = view.getUint32(offset, false);
    offset += 4;
  }

  return { baseDataOffset, defaultDuration, defaultSize };
}

export interface TrunSample {
  size: number;
  duration: number;
}

export function parseTrun(
  buf: Uint8Array,
  contentStart: number,
  defaultDuration: number,
  defaultSize: number,
): { samples: TrunSample[]; dataOffset: number | null } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flags = (buf[contentStart + 1]! << 16) | (buf[contentStart + 2]! << 8) | buf[contentStart + 3]!;
  const count = view.getUint32(contentStart + 4, false);

  let offset = contentStart + 8;
  let dataOffset: number | null = null;

  if (flags & TRUN_DATA_OFFSET) {
    dataOffset = view.getInt32(offset, false);
    offset += 4;
  }
  if (flags & TRUN_FIRST_SAMPLE_FLAGS) offset += 4;

  const samples: TrunSample[] = [];
  for (let i = 0; i < count; i++) {
    let duration = defaultDuration;
    let size = defaultSize;
    if (flags & TRUN_SAMPLE_DURATION) {
      duration = view.getUint32(offset, false);
      offset += 4;
    }
    if (flags & TRUN_SAMPLE_SIZE) {
      size = view.getUint32(offset, false);
      offset += 4;
    }
    if (flags & TRUN_SAMPLE_FLAGS) offset += 4;
    if (flags & TRUN_SAMPLE_CTO) offset += 4;
    samples.push({ size, duration });
  }

  return { samples, dataOffset };
}

export interface SampleRef {
  offset: number;
  size: number;
  duration: number;
}

function* iterTrafSamples(
  buf: Uint8Array,
  trafContent: number,
  trafEnd: number,
  moofStart: number,
): Generator<SampleRef> {
  const tfhd = findBox(buf, trafContent, trafEnd, "tfhd");
  if (!tfhd) return;

  const { baseDataOffset, defaultDuration, defaultSize } = parseTfhd(buf, tfhd.contentStart);
  // Absent an explicit base, offsets are relative to the enclosing moof.
  const base = baseDataOffset ?? moofStart;

  for (const box of iterBoxes(buf, trafContent, trafEnd)) {
    if (box.type !== "trun") continue;
    const { samples, dataOffset } = parseTrun(buf, box.contentStart, defaultDuration, defaultSize);
    let position = base + (dataOffset ?? 0);
    for (const sample of samples) {
      yield { offset: position, size: sample.size, duration: sample.duration };
      position += sample.size;
    }
  }
}

/** Walk every sample in a fragmented MP4, in playback order. */
export function* iterSamples(buf: Uint8Array, end: number): Generator<SampleRef> {
  let pendingMoof: Box | null = null;

  for (const box of iterBoxes(buf, 0, end)) {
    if (box.type === "moof") {
      pendingMoof = box;
    } else if (box.type === "mdat" && pendingMoof) {
      for (const child of iterBoxes(buf, pendingMoof.contentStart, pendingMoof.end)) {
        if (child.type === "traf") {
          yield* iterTrafSamples(buf, child.contentStart, child.end, pendingMoof.start);
        }
      }
      pendingMoof = null;
    }
  }
}

/**
 * Find a codec configuration box (dfLa, dOps, esds ...) inside the audio
 * sample entry of the first track.
 */
export function findCodecBox(
  buf: Uint8Array,
  moovContent: number,
  moovEnd: number,
  boxType: string,
): Box | null {
  const stsd = findPath(buf, moovContent, moovEnd, "trak", "mdia", "minf", "stbl", "stsd");
  if (!stsd) throw new Mp4Error("no moov/trak/mdia/minf/stbl/stsd box");

  // stsd is a FullBox: its payload opens with 4 bytes of version/flags and a
  // 4-byte entry_count, so the sample entries begin 8 bytes into the content.
  for (const entry of iterBoxes(buf, stsd.contentStart + 8, stsd.end)) {
    const childStart = entry.start + AUDIO_SAMPLE_ENTRY_HEADER;
    if (childStart >= entry.end) continue;
    const box = findBox(buf, childStart, entry.end, boxType);
    if (box) return box;
  }
  return null;
}
