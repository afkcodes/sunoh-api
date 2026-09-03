import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * Provisioned Widevine device (.wvd) parsing.
 *
 * Layout, matching pywidevine's serialiser:
 *   "WVD" magic, version, type, security level, flags,
 *   uint16 private key length + DER PKCS#1 private key,
 *   uint16 client id length + serialised ClientIdentification.
 */

export const DeviceType = { CHROME: 1, ANDROID: 2 } as const;

export interface WidevineDevice {
  version: number;
  type: number;
  securityLevel: number;
  flags: number;
  /** DER PKCS#1 RSA private key. */
  privateKeyDer: Uint8Array;
  privateKey: KeyObject;
  /** Serialised ClientIdentification, passed through opaquely. */
  clientId: Uint8Array;
}

export class DeviceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceError";
  }
}

export function parseDevice(bytes: Uint8Array): WidevineDevice {
  if (bytes.length < 8) throw new DeviceError("device file is too short");
  if (bytes[0] !== 0x57 || bytes[1] !== 0x56 || bytes[2] !== 0x44) {
    throw new DeviceError('device file is missing the "WVD" magic');
  }

  const version = bytes[3]!;
  if (version !== 2) {
    throw new DeviceError(`unsupported .wvd version ${version} (only v2 is supported)`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[4]!;
  const securityLevel = bytes[5]!;
  const flags = bytes[6]!;

  let offset = 7;
  const privateKeyLength = view.getUint16(offset, false);
  offset += 2;
  if (offset + privateKeyLength > bytes.length) throw new DeviceError("private key is truncated");
  const privateKeyDer = bytes.subarray(offset, offset + privateKeyLength);
  offset += privateKeyLength;

  const clientIdLength = view.getUint16(offset, false);
  offset += 2;
  if (offset + clientIdLength > bytes.length) throw new DeviceError("client id is truncated");
  const clientId = bytes.subarray(offset, offset + clientIdLength);

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: Buffer.from(privateKeyDer), format: "der", type: "pkcs1" });
  } catch (err) {
    throw new DeviceError(`could not load the device private key: ${String(err)}`);
  }

  return {
    version,
    type,
    securityLevel,
    flags,
    privateKeyDer: new Uint8Array(privateKeyDer),
    privateKey,
    clientId: new Uint8Array(clientId),
  };
}

export function parseDeviceBase64(value: string): WidevineDevice {
  return parseDevice(new Uint8Array(Buffer.from(value.replace(/\s/g, ""), "base64")));
}

export async function loadDeviceFile(path: string): Promise<WidevineDevice> {
  const buf = await readFile(path).catch(() => null);
  if (!buf) throw new DeviceError(`no device file at ${path}`);
  return parseDevice(new Uint8Array(buf));
}
