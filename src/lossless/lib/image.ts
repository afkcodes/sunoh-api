/**
 * Minimal image header parsing.
 *
 * The FLAC PICTURE block carries width/height/depth fields. Writing zeros there
 * is legal but leaves players unable to size the artwork without decoding it,
 * so the dimensions are read straight out of the file header.
 */

export interface ImageInfo {
  mime: string;
  width: number;
  height: number;
  /** Bits per pixel. */
  depth: number;
}

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Uint8Array): boolean {
  return (
    b.length > 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  );
}

function isWebp(b: Uint8Array): boolean {
  return (
    b.length > 15 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  );
}

function parsePng(b: Uint8Array): ImageInfo | null {
  // IHDR is always the first chunk: width and height at bytes 16..23.
  if (b.length < 26) return null;
  const view = new DataView(b.buffer, b.byteOffset);
  const bitDepth = b[24] ?? 8;
  const colourType = b[25] ?? 6;
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : colourType === 4 ? 2 : 1;
  return {
    mime: "image/png",
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
    depth: bitDepth * channels,
  };
}

function parseJpeg(b: Uint8Array): ImageInfo | null {
  // Walk the marker segments looking for a Start-Of-Frame.
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) { offset++; continue; }
    const marker = b[offset + 1]!;
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = ((b[offset + 2]! << 8) | b[offset + 3]!) >>> 0;
    // SOF0-SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const precision = b[offset + 4] ?? 8;
      const height = (b[offset + 5]! << 8) | b[offset + 6]!;
      const width = (b[offset + 7]! << 8) | b[offset + 8]!;
      const components = b[offset + 9] ?? 3;
      return { mime: "image/jpeg", width, height, depth: precision * components };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function parseWebp(b: Uint8Array): ImageInfo | null {
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fourcc === "VP8 " && b.length > 29) {
    return {
      mime: "image/webp",
      width: ((b[26]! | (b[27]! << 8)) & 0x3fff),
      height: ((b[28]! | (b[29]! << 8)) & 0x3fff),
      depth: 24,
    };
  }
  if (fourcc === "VP8L" && b.length > 24) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return {
      mime: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      depth: 24,
    };
  }
  if (fourcc === "VP8X" && b.length > 29) {
    return {
      mime: "image/webp",
      width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
      height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
      depth: 24,
    };
  }
  return null;
}

/** Identify an image and read its dimensions. Returns null for unknown formats. */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (isPng(bytes)) return parsePng(bytes);
  if (isJpeg(bytes)) return parseJpeg(bytes);
  if (isWebp(bytes)) return parseWebp(bytes);
  return null;
}

/** Best-effort MIME type, falling back to a URL's extension then image/jpeg. */
export function guessMime(bytes: Uint8Array, url?: string): string {
  const info = inspectImage(bytes);
  if (info) return info.mime;
  const lower = (url ?? "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
