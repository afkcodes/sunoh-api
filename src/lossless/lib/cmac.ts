/**
 * AES-CMAC (RFC 4493).
 *
 * Widevine derives its session encryption and MAC keys with AES-CMAC, which
 * neither WebCrypto nor node:crypto exposes. It is built here on top of
 * single-block AES-ECB, which node:crypto does provide.
 */

import { createCipheriv } from "node:crypto";

const BLOCK = 16;
/** The Rb constant for the 128-bit block size. */
const RB = 0x87;

/** Encrypt exactly one block with AES-ECB, no padding. */
function aesEcbBlock(key: Uint8Array, block: Uint8Array): Uint8Array<ArrayBuffer> {
  const algorithm =
    key.length === 16 ? "aes-128-ecb" : key.length === 24 ? "aes-192-ecb" : "aes-256-ecb";
  const cipher = createCipheriv(algorithm, key, null);
  cipher.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([cipher.update(block), cipher.final()]));
}

/** Left-shift a 16-byte big-endian value by one bit, XORing in Rb on overflow. */
function shiftLeftXor(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(BLOCK);
  const overflow = (input[0]! & 0x80) !== 0;
  for (let i = 0; i < BLOCK; i++) {
    out[i] = ((input[i]! << 1) & 0xff) | (i < BLOCK - 1 ? input[i + 1]! >>> 7 : 0);
  }
  if (overflow) out[BLOCK - 1] = out[BLOCK - 1]! ^ RB;
  return out;
}

/** Derive the K1 and K2 subkeys from the cipher key. */
export function generateSubkeys(key: Uint8Array): { k1: Uint8Array; k2: Uint8Array } {
  const l = aesEcbBlock(key, new Uint8Array(BLOCK));
  const k1 = shiftLeftXor(l);
  const k2 = shiftLeftXor(k1);
  return { k1, k2 };
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] = target[i]! ^ source[i]!;
}

/** Compute the AES-CMAC tag of `message` under `key`. Returns 16 bytes. */
export function aesCmac(key: Uint8Array, message: Uint8Array): Uint8Array<ArrayBuffer> {
  const { k1, k2 } = generateSubkeys(key);

  const blockCount = Math.ceil(message.length / BLOCK);
  const complete = blockCount > 0 && message.length % BLOCK === 0;
  const n = Math.max(blockCount, 1);

  // The final block is XORed with K1 when it is complete, K2 when it is padded.
  let last: Uint8Array<ArrayBuffer>;
  if (complete) {
    last = new Uint8Array(message.subarray((n - 1) * BLOCK, n * BLOCK));
    xorInto(last, k1);
  } else {
    const remaining = message.subarray((n - 1) * BLOCK);
    last = new Uint8Array(BLOCK);
    last.set(remaining, 0);
    last[remaining.length] = 0x80; // 10* padding
    xorInto(last, k2);
  }

  let x = new Uint8Array(BLOCK);
  for (let i = 0; i < n - 1; i++) {
    const block = new Uint8Array(message.subarray(i * BLOCK, (i + 1) * BLOCK));
    xorInto(x, block);
    x = aesEcbBlock(key, x);
  }
  xorInto(x, last);
  return aesEcbBlock(key, x);
}
