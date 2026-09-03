/**
 * In-process CENC (Widevine) decryption, replacing mp4decrypt.
 *
 * Decrypts an AES-CTR protected fragmented MP4 in place. Nothing moves: the
 * encryption-signalling boxes (senc/saiz/saio/sinf) are renamed to `free` and
 * the sample entry is retyped back to its original codec, so the buffer stays
 * exactly the same length and can be handed straight to the remuxer.
 *
 * Ported from amzdl/remux/decrypt.py.
 */

import { createDecipheriv } from "node:crypto";
import {
  AUDIO_SAMPLE_ENTRY_HEADER,
  findBox,
  findPath,
  iterBoxes,
  parseTfhd,
  parseTrun,
} from "../../lib/mp4";
import { logger } from "../../lib/logger";

const log = logger.child("amazon.cenc");

const SENC_USES_SUBSAMPLES = 0x000002;
const PROTECTION_BOXES = new Set(["senc", "saiz", "saio"]);
const FREE = new Uint8Array([0x66, 0x72, 0x65, 0x65]); // "free"

export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptError";
  }
}

interface TencInfo {
  ivSize: number;
  constantIv: Uint8Array<ArrayBuffer>;
}

function parseTenc(buf: Uint8Array, contentStart: number, boxEnd: number): TencInfo {
  // version/flags(4) reserved(1) default_crypt_byte_block/skip(1)
  // is_protected(1) per_sample_iv_size(1) default_KID(16)
  if (contentStart + 8 + 16 > boxEnd) throw new DecryptError("tenc box is truncated");
  const isProtected = buf[contentStart + 6]!;
  const ivSize = buf[contentStart + 7]!;

  let constantIv = new Uint8Array(0);
  if (ivSize === 0 && isProtected) {
    const offset = contentStart + 8 + 16;
    if (offset < boxEnd) {
      const size = buf[offset]!;
      // Copy: this outlives the box walk and must not alias the buffer.
      constantIv = new Uint8Array(buf.subarray(offset + 1, offset + 1 + size));
    }
  }
  return { ivSize, constantIv };
}

/**
 * Retype the protected sample entry back to its real codec and neutralise the
 * protection boxes, so the output parses as an ordinary unencrypted MP4.
 */
function prepareMoov(buf: Uint8Array, moovContent: number, moovEnd: number): TencInfo {
  const stsd = findPath(buf, moovContent, moovEnd, "trak", "mdia", "minf", "stbl", "stsd");
  if (!stsd) throw new DecryptError("no moov/trak/mdia/minf/stbl/stsd box");

  let info: TencInfo | null = null;

  for (const entry of iterBoxes(buf, stsd.contentStart + 8, stsd.end)) {
    const childStart = entry.start + AUDIO_SAMPLE_ENTRY_HEADER;
    if (childStart >= entry.end) continue;

    const sinf = findBox(buf, childStart, entry.end, "sinf");
    if (!sinf) continue;

    // frma names the original format, e.g. "fLaC" behind an "enca" entry.
    const frma = findBox(buf, sinf.contentStart, sinf.end, "frma");
    if (frma) {
      buf.set(buf.subarray(frma.contentStart, frma.contentStart + 4), entry.start + 4);
    }

    const schm = findBox(buf, sinf.contentStart, sinf.end, "schm");
    if (schm) {
      const scheme = String.fromCharCode(
        buf[schm.contentStart + 4]!, buf[schm.contentStart + 5]!,
        buf[schm.contentStart + 6]!, buf[schm.contentStart + 7]!,
      );
      if (scheme !== "cenc") {
        throw new DecryptError(`unsupported protection scheme "${scheme}"; only cenc is supported`);
      }
    }

    const tenc = findPath(buf, sinf.contentStart, sinf.end, "schi", "tenc");
    if (tenc) info = parseTenc(buf, tenc.contentStart, tenc.end);

    buf.set(FREE, sinf.start + 4);
  }

  if (!info) throw new DecryptError("no protected sample entry or tenc box found in moov");
  return info;
}

interface SencEntry {
  iv: Uint8Array;
  subsamples: Array<{ clear: number; encrypted: number }>;
}

function parseSenc(
  buf: Uint8Array,
  contentStart: number,
  ivSize: number,
): SencEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flags = (buf[contentStart + 1]! << 16) | (buf[contentStart + 2]! << 8) | buf[contentStart + 3]!;
  const sampleCount = view.getUint32(contentStart + 4, false);

  let offset = contentStart + 8;
  const entries: SencEntry[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const iv = ivSize ? buf.subarray(offset, offset + ivSize) : new Uint8Array(0);
    offset += ivSize;

    const subsamples: Array<{ clear: number; encrypted: number }> = [];
    if (flags & SENC_USES_SUBSAMPLES) {
      const subsampleCount = view.getUint16(offset, false);
      offset += 2;
      for (let j = 0; j < subsampleCount; j++) {
        subsamples.push({
          clear: view.getUint16(offset, false),
          encrypted: view.getUint32(offset + 2, false),
        });
        offset += 6;
      }
    }
    entries.push({ iv, subsamples });
  }
  return entries;
}

/** Expand a per-sample IV to a full 16-byte AES-CTR counter block. */
function ctrIv(iv: Uint8Array, constantIv: Uint8Array): Uint8Array {
  const source = iv.length > 0 ? iv : constantIv;
  const out = new Uint8Array(16);
  out.set(source.subarray(0, 16), 0);
  return out;
}

/**
 * Decrypt one sample in place.
 *
 * A single CTR keystream runs across the whole sample, so the clear ranges of a
 * subsample pattern advance the cipher position without being decrypted. The
 * cipher object is reused across subsamples to keep that counter in step.
 */
function decryptSample(
  buf: Uint8Array,
  position: number,
  size: number,
  iv16: Uint8Array,
  subsamples: readonly { clear: number; encrypted: number }[],
  key: Uint8Array,
): void {
  const decipher = createDecipheriv("aes-128-ctr", key, iv16);

  if (subsamples.length === 0) {
    const slice = buf.subarray(position, position + size);
    const plain = decipher.update(Buffer.from(slice));
    buf.set(plain, position);
    return;
  }

  let offset = position;
  for (const { clear, encrypted } of subsamples) {
    offset += clear;
    if (encrypted > 0) {
      const slice = buf.subarray(offset, offset + encrypted);
      buf.set(decipher.update(Buffer.from(slice)), offset);
      offset += encrypted;
    }
  }
}

function processTraf(
  buf: Uint8Array,
  trafContent: number,
  trafEnd: number,
  moofStart: number,
  info: TencInfo,
  key: Uint8Array,
): void {
  const tfhd = findBox(buf, trafContent, trafEnd, "tfhd");
  if (!tfhd) return;
  const { baseDataOffset, defaultDuration, defaultSize } = parseTfhd(buf, tfhd.contentStart);

  const senc = findBox(buf, trafContent, trafEnd, "senc");
  if (!senc) return;
  const entries = parseSenc(buf, senc.contentStart, info.ivSize);
  if (entries.length === 0) return;

  const base = baseDataOffset ?? moofStart;

  let sampleIndex = 0;
  for (const box of iterBoxes(buf, trafContent, trafEnd)) {
    if (box.type !== "trun") continue;
    const { samples, dataOffset } = parseTrun(buf, box.contentStart, defaultDuration, defaultSize);
    let position = base + (dataOffset ?? 0);

    for (const sample of samples) {
      const entry = entries[sampleIndex];
      const iv = entry?.iv ?? new Uint8Array(0);
      const subsamples = entry?.subsamples ?? [];
      if (iv.length > 0 || info.constantIv.length > 0) {
        decryptSample(buf, position, sample.size, ctrIv(iv, info.constantIv), subsamples, key);
      }
      position += sample.size;
      sampleIndex++;
    }
  }

  // Neutralise the boxes that still claim the fragment is protected.
  for (const box of iterBoxes(buf, trafContent, trafEnd)) {
    const isSeigGroup =
      (box.type === "sbgp" || box.type === "sgpd") &&
      String.fromCharCode(
        buf[box.contentStart + 4]!, buf[box.contentStart + 5]!,
        buf[box.contentStart + 6]!, buf[box.contentStart + 7]!,
      ) === "seig";
    if (PROTECTION_BOXES.has(box.type) || isSeigGroup) {
      buf.set(FREE, box.start + 4);
    }
  }
}

/** Parse a "kid:key" or bare hex key into raw bytes. */
export function parseContentKey(key: string): Uint8Array {
  const hex = key.includes(":") ? key.split(":").pop()!.trim() : key.trim();
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new DecryptError(`content key must be 16 bytes of hex, got "${hex}"`);
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/**
 * Decrypt a fragmented MP4 in place. `buf` is mutated and returned, so pass a
 * copy if the ciphertext is still needed.
 */
export function decryptMp4(buf: Uint8Array, contentKey: string): Uint8Array {
  const key = parseContentKey(contentKey);

  const moov = findBox(buf, 0, buf.length, "moov");
  if (!moov) throw new DecryptError("no moov box found");
  const info = prepareMoov(buf, moov.contentStart, moov.end);

  let fragments = 0;
  let pendingMoof: { start: number; contentStart: number; end: number } | null = null;

  for (const box of iterBoxes(buf, 0, buf.length)) {
    if (box.type === "moof") {
      pendingMoof = box;
    } else if (box.type === "mdat" && pendingMoof) {
      for (const child of iterBoxes(buf, pendingMoof.contentStart, pendingMoof.end)) {
        if (child.type === "traf") {
          processTraf(buf, child.contentStart, child.end, pendingMoof.start, info, key);
        }
      }
      fragments++;
      pendingMoof = null;
    }
  }

  if (fragments === 0) throw new DecryptError("no moof/mdat fragments found to decrypt");
  log.debug(`decrypted ${fragments} fragment(s)`);
  return buf;
}

/**
 * Decrypt a DASH init segment plus one media segment together.
 *
 * The tenc parameters live in the init segment's moov while the encrypted
 * samples live in the media segment, so both are needed. The init segment is
 * decrypted (retyped) once and reused across every media segment.
 */
export function createSegmentDecryptor(
  initSegment: Uint8Array,
  contentKey: string,
): { init: Uint8Array; decrypt: (segment: Uint8Array) => Uint8Array } {
  const key = parseContentKey(contentKey);
  const init = new Uint8Array(initSegment);

  const moov = findBox(init, 0, init.length, "moov");
  if (!moov) throw new DecryptError("init segment has no moov box");
  const info = prepareMoov(init, moov.contentStart, moov.end);

  return {
    init,
    decrypt(segment: Uint8Array): Uint8Array {
      const buf = new Uint8Array(segment);
      let pendingMoof: { start: number; contentStart: number; end: number } | null = null;
      for (const box of iterBoxes(buf, 0, buf.length)) {
        if (box.type === "moof") {
          pendingMoof = box;
        } else if (box.type === "mdat" && pendingMoof) {
          for (const child of iterBoxes(buf, pendingMoof.contentStart, pendingMoof.end)) {
            if (child.type === "traf") {
              processTraf(buf, child.contentStart, child.end, pendingMoof.start, info, key);
            }
          }
          pendingMoof = null;
        }
      }
      return buf;
    },
  };
}
