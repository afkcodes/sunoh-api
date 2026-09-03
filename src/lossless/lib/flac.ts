/**
 * FLAC metadata writing, replacing mutagen.
 *
 * A FLAC file is "fLaC" followed by a run of metadata blocks and then the audio
 * frames. Only the header needs rewriting to tag a file, so the audio is never
 * buffered: we parse and replace the metadata blocks, emit the new header, then
 * pass the frames straight through. Tagging a 24-bit/192kHz track therefore
 * costs a few hundred kilobytes of memory rather than a few hundred megabytes.
 */

import { guessMime, inspectImage } from "./image";

export const FLAC_MAGIC = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // "fLaC"

export const BlockType = {
  STREAMINFO: 0,
  PADDING: 1,
  APPLICATION: 2,
  SEEKTABLE: 3,
  VORBIS_COMMENT: 4,
  CUESHEET: 5,
  PICTURE: 6,
} as const;

export interface MetadataBlock {
  type: number;
  data: Uint8Array;
}

export interface FlacTags {
  TITLE?: string;
  ARTIST?: string;
  ALBUM?: string;
  ALBUMARTIST?: string;
  DATE?: string;
  YEAR?: string;
  RELEASEDATE?: string;
  TRACKNUMBER?: string;
  TRACKTOTAL?: string;
  DISCNUMBER?: string;
  DISCTOTAL?: string;
  ISRC?: string;
  COPYRIGHT?: string;
  GENRE?: string;
  COMPOSER?: string;
  LABEL?: string;
  LYRICS?: string;
  COMMENT?: string;
  [key: string]: string | undefined;
}

export interface FlacPicture {
  mime: string;
  data: Uint8Array;
  /** 3 = front cover. */
  type?: number;
  description?: string;
  width?: number;
  height?: number;
  depth?: number;
}

const VENDOR = "ClashFLAC Lossless Engine";

function u32be(value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, false);
  return b;
}

function u32le(value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, true);
  return b;
}

function concat(parts: readonly Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * VORBIS_COMMENT payload. Lengths here are little-endian, unlike every other
 * FLAC block, which is a genuine quirk of the format rather than a mistake.
 */
export function buildVorbisComment(tags: FlacTags): Uint8Array {
  const enc = new TextEncoder();
  const vendor = enc.encode(VENDOR);

  const comments: Uint8Array[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null || value === "") continue;
    // A field may legitimately repeat, e.g. one ARTIST line per performer.
    for (const line of String(value).split("\n")) {
      if (!line) continue;
      const bytes = enc.encode(`${key.toUpperCase()}=${line}`);
      comments.push(u32le(bytes.length), bytes);
    }
  }

  const count = comments.length / 2;
  return concat([u32le(vendor.length), vendor, u32le(count), ...comments]);
}

/** PICTURE payload, all big-endian. */
export function buildPicture(pic: FlacPicture): Uint8Array {
  const enc = new TextEncoder();
  const mime = enc.encode(pic.mime);
  const desc = enc.encode(pic.description ?? "Front Cover");
  return concat([
    u32be(pic.type ?? 3),
    u32be(mime.length),
    mime,
    u32be(desc.length),
    desc,
    u32be(pic.width ?? 0),
    u32be(pic.height ?? 0),
    u32be(pic.depth ?? 24),
    u32be(0), // indexed-colour count; 0 for non-indexed images
    u32be(pic.data.length),
    pic.data,
  ]);
}

/** Serialise blocks back into a full FLAC header, setting the last-block flag. */
export function buildHeader(blocks: readonly MetadataBlock[]): Uint8Array {
  const parts: Uint8Array[] = [FLAC_MAGIC];
  blocks.forEach((block, index) => {
    const isLast = index === blocks.length - 1;
    const header = new Uint8Array(4);
    header[0] = (isLast ? 0x80 : 0x00) | (block.type & 0x7f);
    header[1] = (block.data.length >>> 16) & 0xff;
    header[2] = (block.data.length >>> 8) & 0xff;
    header[3] = block.data.length & 0xff;
    parts.push(header, block.data);
  });
  return concat(parts);
}

/**
 * Replace the VORBIS_COMMENT and PICTURE blocks, keeping STREAMINFO first and
 * dropping padding (which exists only to make in-place edits cheap, and we are
 * rewriting the header wholesale).
 */
export function applyTags(
  blocks: readonly MetadataBlock[],
  tags: FlacTags,
  picture?: FlacPicture,
): MetadataBlock[] {
  const out: MetadataBlock[] = [];

  const streamInfo = blocks.find((b) => b.type === BlockType.STREAMINFO);
  if (streamInfo) out.push(streamInfo);

  for (const block of blocks) {
    if (block === streamInfo) continue;
    if (block.type === BlockType.STREAMINFO) continue;
    if (block.type === BlockType.VORBIS_COMMENT) continue;
    if (block.type === BlockType.PICTURE) continue;
    if (block.type === BlockType.PADDING) continue;
    out.push(block);
  }

  out.push({ type: BlockType.VORBIS_COMMENT, data: buildVorbisComment(tags) });
  if (picture && picture.data.length > 0) {
    out.push({ type: BlockType.PICTURE, data: buildPicture(picture) });
  }
  return out;
}

/** Parse the metadata blocks of a complete in-memory FLAC file. */
export function parseBlocks(bytes: Uint8Array): { blocks: MetadataBlock[]; audioOffset: number } {
  if (bytes.length < 4 || !FLAC_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("Not a FLAC stream (missing fLaC magic)");
  }
  const blocks: MetadataBlock[] = [];
  let offset = 4;
  for (;;) {
    if (offset + 4 > bytes.length) throw new Error("Truncated FLAC metadata");
    const flagAndType = bytes[offset]!;
    const isLast = (flagAndType & 0x80) !== 0;
    const type = flagAndType & 0x7f;
    const length = (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    offset += 4;
    if (offset + length > bytes.length) throw new Error("Truncated FLAC metadata block");
    blocks.push({ type, data: bytes.subarray(offset, offset + length) });
    offset += length;
    if (isLast) break;
  }
  return { blocks, audioOffset: offset };
}

/** Tag a complete in-memory FLAC file. */
export function tagBuffer(bytes: Uint8Array, tags: FlacTags, picture?: FlacPicture): Uint8Array {
  const { blocks, audioOffset } = parseBlocks(bytes);
  return concat([buildHeader(applyTags(blocks, tags, picture)), bytes.subarray(audioOffset)]);
}

/**
 * Tag a FLAC stream without buffering the audio.
 *
 * Only the metadata section is accumulated (kilobytes); once the audio frames
 * begin, every subsequent chunk is forwarded untouched.
 */
export function tagStream(
  source: ReadableStream<Uint8Array>,
  tags: FlacTags,
  picture?: FlacPicture,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let buffer = new Uint8Array(0);
  let headerDone = false;

  /** Parse a complete metadata section out of `buffer`, or null if more bytes are needed. */
  function tryParse(): { header: Uint8Array; rest: Uint8Array } | null {
    if (buffer.length < 4) return null;
    if (!FLAC_MAGIC.every((b, i) => buffer[i] === b)) {
      throw new Error("Not a FLAC stream (missing fLaC magic)");
    }
    const blocks: MetadataBlock[] = [];
    let offset = 4;
    for (;;) {
      if (offset + 4 > buffer.length) return null;
      const flagAndType = buffer[offset]!;
      const isLast = (flagAndType & 0x80) !== 0;
      const type = flagAndType & 0x7f;
      const length = (buffer[offset + 1]! << 16) | (buffer[offset + 2]! << 8) | buffer[offset + 3]!;
      if (offset + 4 + length > buffer.length) return null;
      blocks.push({ type, data: buffer.subarray(offset + 4, offset + 4 + length) });
      offset += 4 + length;
      if (isLast) break;
    }
    return {
      header: buildHeader(applyTags(blocks, tags, picture)),
      rest: buffer.subarray(offset),
    };
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (headerDone) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value?.length) controller.enqueue(value);
        return;
      }

      for (;;) {
        const parsed = tryParse();
        if (parsed) {
          headerDone = true;
          controller.enqueue(parsed.header);
          if (parsed.rest.length > 0) controller.enqueue(new Uint8Array(parsed.rest));
          buffer = new Uint8Array(0);
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          // Stream ended mid-header: emit what we have rather than truncating.
          headerDone = true;
          if (buffer.length > 0) controller.enqueue(new Uint8Array(buffer));
          controller.close();
          return;
        }
        if (value?.length) buffer = concat([buffer, value]);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Read STREAMINFO into the fields useful for reporting quality. */
export function readStreamInfo(data: Uint8Array): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  totalSamples: number;
  durationSec: number;
} | null {
  if (data.length < 34) return null;
  const sampleRate = (data[10]! << 12) | (data[11]! << 4) | (data[12]! >> 4);
  const channels = ((data[12]! >> 1) & 0x07) + 1;
  const bitsPerSample = (((data[12]! & 0x01) << 4) | (data[13]! >> 4)) + 1;
  // 36-bit total sample count, spanning the low nibble of byte 13 through byte 17.
  const totalSamples =
    (data[13]! & 0x0f) * 2 ** 32 +
    data[14]! * 2 ** 24 +
    data[15]! * 2 ** 16 +
    data[16]! * 2 ** 8 +
    data[17]!;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples,
    durationSec: sampleRate > 0 ? totalSamples / sampleRate : 0,
  };
}

/** Build a STREAMINFO block from scratch, for remuxed streams that lack one. */
export function buildStreamInfo(params: {
  minBlockSize: number;
  maxBlockSize: number;
  minFrameSize: number;
  maxFrameSize: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  totalSamples: number;
  md5?: Uint8Array;
}): Uint8Array {
  const b = new Uint8Array(34);
  const view = new DataView(b.buffer);
  view.setUint16(0, params.minBlockSize, false);
  view.setUint16(2, params.maxBlockSize, false);
  b[4] = (params.minFrameSize >>> 16) & 0xff;
  b[5] = (params.minFrameSize >>> 8) & 0xff;
  b[6] = params.minFrameSize & 0xff;
  b[7] = (params.maxFrameSize >>> 16) & 0xff;
  b[8] = (params.maxFrameSize >>> 8) & 0xff;
  b[9] = params.maxFrameSize & 0xff;

  const sr = params.sampleRate & 0xfffff;
  const ch = (params.channels - 1) & 0x07;
  const bps = (params.bitsPerSample - 1) & 0x1f;
  b[10] = (sr >>> 12) & 0xff;
  b[11] = (sr >>> 4) & 0xff;
  b[12] = ((sr & 0x0f) << 4) | (ch << 1) | ((bps >>> 4) & 0x01);
  b[13] = ((bps & 0x0f) << 4) | Number((BigInt(params.totalSamples) >> 32n) & 0x0fn);
  view.setUint32(14, Number(BigInt(params.totalSamples) & 0xffffffffn), false);

  if (params.md5 && params.md5.length === 16) b.set(params.md5, 18);
  return b;
}

/**
 * Build a PICTURE from raw image bytes, filling in the MIME type and real
 * dimensions rather than leaving the header fields zeroed.
 */
export function makePicture(
  data: Uint8Array,
  opts: { url?: string; description?: string; type?: number } = {},
): FlacPicture {
  const info = inspectImage(data);
  return {
    mime: info?.mime ?? guessMime(data, opts.url),
    data,
    type: opts.type ?? 3,
    description: opts.description ?? "Front Cover",
    width: info?.width ?? 0,
    height: info?.height ?? 0,
    depth: info?.depth ?? 24,
  };
}
