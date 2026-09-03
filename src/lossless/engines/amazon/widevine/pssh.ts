/**
 * PSSH parsing.
 *
 * A PSSH may arrive as a full `pssh` box or as bare WidevinePsshData init data.
 * The license request needs the init data, so a box is unwrapped and anything
 * else is passed through.
 */

/** edef8ba9-79d6-4ace-a3c8-27dcd51d21ed */
export const WIDEVINE_SYSTEM_ID = new Uint8Array([
  0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed,
]);

export class PsshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PsshError";
  }
}

function isPsshBox(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[4] === 0x70 && bytes[5] === 0x73 && bytes[6] === 0x73 && bytes[7] === 0x68
  );
}

/** Extract the Widevine init data from a PSSH box, or return it unchanged. */
export function parsePssh(input: string | Uint8Array): Uint8Array {
  const bytes =
    typeof input === "string"
      ? new Uint8Array(Buffer.from(input.replace(/\s/g, ""), "base64"))
      : input;

  if (bytes.length === 0) throw new PsshError("empty PSSH");
  if (!isPsshBox(bytes)) {
    // Already bare init data.
    return bytes;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  if (boxSize > bytes.length) throw new PsshError("PSSH box length exceeds the buffer");

  const version = bytes[8]!;
  let offset = 12; // size + type + version/flags

  const systemId = bytes.subarray(offset, offset + 16);
  offset += 16;
  if (!WIDEVINE_SYSTEM_ID.every((b, i) => systemId[i] === b)) {
    throw new PsshError("PSSH is not a Widevine box");
  }

  if (version > 0) {
    // Version 1 carries a key-id list before the data.
    const kidCount = view.getUint32(offset, false);
    offset += 4 + kidCount * 16;
  }

  const dataSize = view.getUint32(offset, false);
  offset += 4;
  if (offset + dataSize > bytes.length) throw new PsshError("PSSH data length exceeds the buffer");

  return new Uint8Array(bytes.subarray(offset, offset + dataSize));
}

/** Locate a Widevine PSSH box inside an initialisation segment. */
export function findPsshInInit(segment: Uint8Array): Uint8Array | null {
  // Scan for the "pssh" fourcc rather than walking boxes: the box can be nested
  // under moov or sit at the top level depending on the packager.
  for (let i = 0; i + 8 <= segment.length; i++) {
    if (
      segment[i + 4] === 0x70 && segment[i + 5] === 0x73 &&
      segment[i + 6] === 0x73 && segment[i + 7] === 0x68
    ) {
      const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
      const size = view.getUint32(i, false);
      if (size < 32 || i + size > segment.length) continue;
      const box = segment.subarray(i, i + size);
      const systemId = box.subarray(12, 28);
      if (WIDEVINE_SYSTEM_ID.every((b, k) => systemId[k] === b)) {
        return new Uint8Array(box);
      }
    }
  }
  return null;
}
