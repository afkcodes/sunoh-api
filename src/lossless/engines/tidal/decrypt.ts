/**
 * Tidal stream decryption.
 *
 * Legacy Tidal streams are AES-CTR encrypted under a per-track key that is
 * itself wrapped with a fixed master key. Ported from tidal/decryption.py
 * (originally yaronzz/Tidal-Media-Downloader and RedSea). WebCrypto covers both
 * primitives natively, so no crypto dependency is needed.
 */

import { createDecipheriv } from "node:crypto";

/** The published Tidal master key used to unwrap per-track security tokens. */
const MASTER_KEY_B64 = "UIlTTEMmmLfGowo/UC60x2H45W6MdGgTRfo/umg4754=";

const AES_BLOCK = 16;

/**
 * WebCrypto's BufferSource excludes SharedArrayBuffer-backed views. Nothing
 * here is ever shared-backed, so the narrower type is asserted at the crypto
 * boundary rather than copying every chunk.
 */
type Bytes = Uint8Array<ArrayBuffer>;

export interface TrackKey {
  key: Bytes;
  nonce: Bytes;
}

function b64ToBytes(value: string): Bytes {
  // Copy into a fresh ArrayBuffer: Buffer views share a pooled allocation.
  const buf = Buffer.from(value, "base64");
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}

/**
 * Unwrap a securityToken into the per-track (key, nonce) pair.
 *
 * The token is IV || ciphertext under AES-256-CBC with the master key. The
 * payload is not PKCS#7 padded, and WebCrypto's AES-CBC always strips a final
 * padding block, so node:crypto is used here purely for setAutoPadding(false).
 */
export async function decryptSecurityToken(securityToken: string): Promise<TrackKey> {
  const master = b64ToBytes(MASTER_KEY_B64);
  const token = b64ToBytes(securityToken);
  if (token.length < 32) throw new Error("Tidal security token is too short");

  const iv = token.subarray(0, 16);
  const ciphertext = token.subarray(16);
  if (ciphertext.length % AES_BLOCK !== 0) {
    throw new Error("Tidal security token is not block aligned");
  }

  const decipher = createDecipheriv("aes-256-cbc", master, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const key = new Uint8Array(16);
  key.set(plain.subarray(0, 16));
  const nonce = new Uint8Array(8);
  nonce.set(plain.subarray(16, 24));
  return { key, nonce };
}

/** Build the 16-byte AES-CTR counter block for a given block index. */
function counterBlock(nonce: Bytes, blockIndex: bigint): Bytes {
  const counter = new Uint8Array(AES_BLOCK);
  counter.set(nonce.subarray(0, 8), 0);
  // Low 64 bits are the block counter, big-endian, starting at zero.
  new DataView(counter.buffer).setBigUint64(8, blockIndex, false);
  return counter;
}

/** Decrypt a complete AES-CTR payload. */
export async function decryptBuffer(data: Uint8Array, trackKey: TrackKey): Promise<Uint8Array> {
  const payload = data as Bytes;
  const cryptoKey = await crypto.subtle.importKey("raw", trackKey.key, { name: "AES-CTR" }, false, [
    "decrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: counterBlock(trackKey.nonce, 0n), length: 64 },
      cryptoKey,
      payload,
    ),
  );
}

/**
 * Decrypt an AES-CTR stream without buffering it.
 *
 * CTR is a stream cipher over 16-byte blocks, so each chunk is decrypted with
 * the counter advanced by the number of blocks already consumed. Partial blocks
 * are held back until the next chunk arrives, since splitting one across two
 * decrypt calls would desynchronise the keystream.
 */
export function decryptStream(
  source: ReadableStream<Uint8Array>,
  trackKey: TrackKey,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let cryptoKey: CryptoKey | null = null;
  let blockIndex = 0n;
  let remainder = new Uint8Array(0);

  async function decryptAligned(data: Uint8Array): Promise<Uint8Array> {
    const payload = data as Bytes;
    cryptoKey ??= await crypto.subtle.importKey("raw", trackKey.key, { name: "AES-CTR" }, false, [
      "decrypt",
    ]);
    const out = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-CTR", counter: counterBlock(trackKey.nonce, blockIndex), length: 64 },
        cryptoKey,
        payload,
      ),
    );
    blockIndex += BigInt(Math.ceil(data.length / AES_BLOCK));
    return out;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          if (remainder.length > 0) {
            // Final partial block: CTR needs no padding, so decrypt as-is.
            controller.enqueue(await decryptAligned(remainder));
            remainder = new Uint8Array(0);
          }
          controller.close();
          return;
        }
        if (!value?.length) continue;

        const combined = new Uint8Array(remainder.length + value.length);
        combined.set(remainder, 0);
        combined.set(value, remainder.length);

        const alignedLength = combined.length - (combined.length % AES_BLOCK);
        if (alignedLength === 0) {
          remainder = combined;
          continue;
        }

        remainder = combined.subarray(alignedLength);
        // Copy, because the subarray above aliases the buffer we hand off.
        remainder = new Uint8Array(remainder);
        controller.enqueue(await decryptAligned(combined.subarray(0, alignedLength)));
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
