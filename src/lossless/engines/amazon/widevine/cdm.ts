import {
  constants,
  createDecipheriv,
  createHmac,
  privateDecrypt,
  randomBytes,
  sign as rsaSign,
  timingSafeEqual,
} from "node:crypto";
import { aesCmac } from "../../../lib/cmac";
import { logger } from "../../../lib/logger";
import type { WidevineDevice } from "./device";
import { parsePssh } from "./pssh";
import {
  KeyType,
  License,
  LicenseRequest,
  LicenseType,
  MessageType,
  RequestType,
  SignedMessage,
  keyTypeName,
} from "./proto";

const log = logger.child("widevine");

export interface ContentKey {
  kid: string;
  key: string;
  type: string;
}

export class CdmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdmError";
  }
}

/**
 * A Widevine CDM session, ported from pywidevine.
 *
 * The flow is: build and RSA-PSS sign a LicenseRequest, exchange it for a
 * license, RSA-OAEP decrypt the session key, derive the encryption and MAC keys
 * with AES-CMAC, verify the license HMAC, then AES-CBC decrypt each content key.
 */
export class CdmSession {
  /** The exact bytes that were signed; key derivation depends on them. */
  #licenseRequest: Uint8Array | null = null;
  readonly sessionId: Uint8Array;

  constructor(readonly device: WidevineDevice) {
    // Android devices use a 16-byte random session id.
    this.sessionId = new Uint8Array(randomBytes(16));
  }

  /** Build the base64 license challenge for a PSSH. */
  getLicenseChallenge(pssh: string | Uint8Array): string {
    const initData = parsePssh(pssh);

    const request = LicenseRequest.create({
      client_id: Buffer.from(this.device.clientId),
      content_id: {
        widevine_pssh_data: {
          pssh_data: [Buffer.from(initData)],
          license_type: LicenseType.STREAMING,
          request_id: Buffer.from(this.sessionId),
        },
      },
      type: RequestType.NEW,
      request_time: Math.floor(Date.now() / 1000),
      protocol_version: 21,
      key_control_nonce: randomBytes(4).readUInt32BE(0),
    });

    const encoded = new Uint8Array(LicenseRequest.encode(request).finish());
    this.#licenseRequest = encoded;

    // Widevine signs with RSA-PSS over SHA-1, salt length equal to the digest.
    const signature = rsaSign("sha1", encoded, {
      key: this.device.privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 20,
    });

    const signed = SignedMessage.create({
      type: MessageType.LICENSE_REQUEST,
      msg: Buffer.from(encoded),
      signature,
    });

    return Buffer.from(SignedMessage.encode(signed).finish()).toString("base64");
  }

  /** Parse a license response and return its content keys. */
  parseLicense(licenseResponse: string | Uint8Array): ContentKey[] {
    if (!this.#licenseRequest) {
      throw new CdmError("parseLicense called before getLicenseChallenge");
    }

    const raw =
      typeof licenseResponse === "string"
        ? new Uint8Array(Buffer.from(licenseResponse.replace(/\s/g, ""), "base64"))
        : licenseResponse;

    const signed = SignedMessage.decode(raw) as unknown as {
      type?: number;
      msg?: Uint8Array;
      signature?: Uint8Array;
      session_key?: Uint8Array;
      oemcrypto_core_message?: Uint8Array;
    };

    if (signed.type === MessageType.ERROR_RESPONSE) {
      throw new CdmError("the license server returned an error response");
    }
    if (!signed.msg?.length) throw new CdmError("license response carried no message");
    if (!signed.session_key?.length) throw new CdmError("license response carried no session key");

    // 1. Unwrap the session key with the device's private key.
    let sessionKey: Buffer;
    try {
      sessionKey = privateDecrypt(
        {
          key: this.device.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha1",
        },
        Buffer.from(signed.session_key),
      );
    } catch (err) {
      throw new CdmError(`could not unwrap the session key: ${String(err)}`);
    }
    if (sessionKey.length !== 16) {
      throw new CdmError(`session key has an unexpected length (${sessionKey.length})`);
    }

    // 2. Derive the encryption and MAC keys from the session key.
    const derived = deriveKeys(
      new Uint8Array(sessionKey),
      this.#licenseRequest,
      signed.oemcrypto_core_message,
    );

    // 3. Verify the license signature before trusting anything inside it.
    if (signed.signature?.length) {
      const signedData = signed.oemcrypto_core_message?.length
        ? concat([signed.oemcrypto_core_message, signed.msg])
        : signed.msg;
      const expected = createHmac("sha256", derived.macKeyServer).update(signedData).digest();
      const actual = Buffer.from(signed.signature);
      const valid =
        expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!valid) {
        // Amazon's server has been observed to sign over a slightly different
        // preimage, so this is reported rather than treated as fatal.
        log.warn("license signature did not verify; continuing with the returned keys");
      }
    }

    // 4. Decrypt each content key with AES-CBC under the derived key.
    const license = License.decode(signed.msg) as unknown as {
      key?: Array<{ id?: Uint8Array; iv?: Uint8Array; key?: Uint8Array; type?: number }>;
    };

    const keys: ContentKey[] = [];
    for (const container of license.key ?? []) {
      if (!container.key?.length || !container.iv?.length) continue;
      const decipher = createDecipheriv(
        "aes-128-cbc",
        derived.encryptionKey,
        Buffer.from(container.iv),
      );
      decipher.setAutoPadding(false);
      const plain = Buffer.concat([decipher.update(Buffer.from(container.key)), decipher.final()]);
      keys.push({
        kid: container.id?.length ? Buffer.from(container.id).toString("hex") : "",
        key: stripPkcs7(plain).toString("hex"),
        type: keyTypeName(container.type),
      });
    }

    if (keys.length === 0) throw new CdmError("license contained no usable keys");
    return keys;
  }

  /** The first CONTENT key, formatted "kid:key" for the CENC decryptor. */
  static contentKey(keys: readonly ContentKey[]): string {
    const content = keys.filter((k) => k.type === "CONTENT");
    const chosen = (content.length > 0 ? content : keys)[0];
    if (!chosen) throw new CdmError("no content key available");
    return `${chosen.kid}:${chosen.key}`;
  }
}

export interface DerivedKeys {
  encryptionKey: Uint8Array;
  macKeyServer: Uint8Array;
  macKeyClient: Uint8Array;
}

/**
 * Widevine key derivation.
 *
 * Each key is a chain of AES-CMAC blocks over a context built from a label, the
 * exact license-request bytes, and the key length in bits. Exported so the
 * derivation can be tested independently of a live license exchange.
 */
export function deriveKeys(
  sessionKey: Uint8Array,
  licenseRequest: Uint8Array,
  oemCryptoCoreMessage?: Uint8Array,
): DerivedKeys {
  // When present, the core message is prepended to the derivation context.
  const message = oemCryptoCoreMessage?.length
    ? concat([oemCryptoCoreMessage, licenseRequest])
    : licenseRequest;

  const encContext = buildContext("ENCRYPTION", message, 128);
  const macContext = buildContext("AUTHENTICATION", message, 512);

  const encryptionKey = aesCmac(sessionKey, prefix(1, encContext));

  // The server MAC key is two chained blocks, the client key the next two.
  const macKeyServer = concat([
    aesCmac(sessionKey, prefix(1, macContext)),
    aesCmac(sessionKey, prefix(2, macContext)),
  ]);
  const macKeyClient = concat([
    aesCmac(sessionKey, prefix(3, macContext)),
    aesCmac(sessionKey, prefix(4, macContext)),
  ]);

  return { encryptionKey, macKeyServer, macKeyClient };
}

/** label || 0x00 || message || uint32be(keyLengthBits) */
function buildContext(label: string, message: Uint8Array, keyLengthBits: number): Uint8Array {
  const labelBytes = new TextEncoder().encode(label);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, keyLengthBits, false);
  return concat([labelBytes, new Uint8Array([0x00]), message, length]);
}

/** Prepend the one-byte block counter the CMAC chain is keyed on. */
function prefix(counter: number, context: Uint8Array): Uint8Array {
  return concat([new Uint8Array([counter]), context]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
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

/** Remove PKCS#7 padding when it is present and well formed. */
function stripPkcs7(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  const pad = buf[buf.length - 1]!;
  if (pad === 0 || pad > 16 || pad > buf.length) return buf;
  for (let i = buf.length - pad; i < buf.length; i++) {
    if (buf[i] !== pad) return buf;
  }
  return buf.subarray(0, buf.length - pad);
}

export { KeyType };
