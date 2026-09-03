import { createHash, createPrivateKey, createSign, randomBytes, type KeyObject } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../../config";
import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import {
  APP_VERSION,
  ASSOC_HANDLE,
  DEVICE_TYPE,
  WEB_USER_AGENT,
  regionFor,
  type AmazonCredentials,
  type AmazonRegion,
} from "./models";

const log = logger.child("amazon.auth");

/** A pending device login, held between building the URL and redeeming the code. */
export interface PendingLogin {
  oauthUrl: string;
  codeVerifier: string;
  serial: string;
  region: AmazonRegion;
  createdAt: number;
}

function base64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A plausible Android device serial, matching the upstream generator's shape. */
function buildDeviceSerial(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

function buildClientId(serial: string, deviceType: string): string {
  return Buffer.from(`${serial}#${deviceType}`, "utf8").toString("hex");
}

function codeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/** Initial cookies that keep Amazon from showing a captcha in most cases. */
function buildInitCookies(): Record<string, string> {
  const frc = base64Url(randomBytes(313));
  const amznAppId = "MAPAndroidLib-1.3.4028.0";
  const mapMd = {
    device_registration_data: { software_version: "130050002" },
    app_identifier: {
      package: "com.amazon.mp3",
      "SHA-256": ["2f19adeb284eb36f7f07786152b9a1d14b21653203ad0b04ebbf9c73ab6d7625"],
      app_version: "523160014",
      app_version_name: APP_VERSION,
      app_sms_hash: "QGCBba+brC5",
      map_version: amznAppId,
    },
    app_info: {
      auto_pv: 0,
      auto_pv_with_smsretriever: 0,
      smartlock_supported: 0,
      permission_runtime_grant: 2,
    },
    device_user_dictionary: [],
  };
  return {
    frc,
    "map-md": Buffer.from(JSON.stringify(mapMd)).toString("base64").replace(/=+$/, ""),
    "amzn-app-id": amznAppId,
  };
}

/**
 * Build the Amazon sign-in URL for the device OAuth flow.
 *
 * The user opens this, signs in, and is redirected to /ap/maplanding with an
 * `openid.oa2.authorization_code` in the query string. That code plus the
 * verifier held here completes registration.
 */
export function buildLoginUrl(country = "US"): PendingLogin {
  const region = regionFor(country);
  const domain = region.domainTld;
  const codeVerifier = base64Url(randomBytes(32));
  const serial = `PIXEL5${buildDeviceSerial()}`;
  const clientId = buildClientId(serial, DEVICE_TYPE.MUSIC);

  const params = new URLSearchParams({
    "openid.pape.max_auth_age": "0",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    accountStatusPolicy: "P1",
    language: region.locale,
    "openid.return_to": `https://www.amazon.${domain}/ap/maplanding`,
    "openid.assoc_handle": ASSOC_HANDLE.MUSIC,
    "openid.oa2.response_type": "code",
    "openid.mode": "checkid_setup",
    "openid.ns.pape": "http://specs.openid.net/extensions/pape/1.0",
    "openid.oa2.code_challenge_method": "S256",
    "openid.ns.oa2": `http://www.amazon.${domain}/ap/ext/oauth/2`,
    "openid.oa2.code_challenge": codeChallenge(codeVerifier),
    "openid.oa2.scope": "device_auth_access",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.oa2.client_id": `device:${clientId}`,
    disableLoginPrepopulate: "0",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    forceMobileLayout: "true",
  });

  return {
    oauthUrl: `https://www.amazon.${domain}/ap/signin?${params.toString()}`,
    codeVerifier,
    serial,
    region,
    createdAt: Date.now(),
  };
}

/** Pull the authorization code out of the maplanding redirect URL. */
export function extractAuthorizationCode(redirectUrl: string): string | null {
  try {
    const url = new URL(redirectUrl.trim());
    return url.searchParams.get("openid.oa2.authorization_code");
  } catch {
    // Also accept a bare code pasted by the user.
    const trimmed = redirectUrl.trim();
    return /^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
  }
}

/** Complete registration, exchanging the authorization code for credentials. */
export async function registerDevice(
  pending: PendingLogin,
  authorizationCode: string,
): Promise<AmazonCredentials> {
  const { region, serial, codeVerifier } = pending;
  const body = {
    requested_token_type: [
      "bearer",
      "mac_dms",
      "website_cookies",
      "store_authentication_cookie",
    ],
    cookies: { website_cookies: [], domain: `.amazon.${region.domainTld}` },
    registration_data: {
      domain: "Device",
      app_version: "523160014",
      device_type: DEVICE_TYPE.MUSIC,
      device_name: "ClashFLAC",
      os_version: "13",
      device_serial: serial,
      device_model: "Pixel 5",
      app_name: "com.amazon.mp3",
      software_version: "130050002",
    },
    auth_data: {
      client_id: buildClientId(serial, DEVICE_TYPE.MUSIC),
      authorization_code: authorizationCode,
      code_verifier: codeVerifier,
      code_algorithm: "SHA-256",
      client_domain: "DeviceLegacy",
    },
    user_context_map: { frc: buildInitCookies().frc },
    requested_extensions: ["device_info", "customer_info"],
  };

  const res = await request(`https://api.amazon.${region.domainTld}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": WEB_USER_AGENT },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });

  const json = (await res.json()) as {
    response?: {
      success?: {
        tokens?: {
          mac_dms?: { adp_token?: string; device_private_key?: string };
          bearer?: { access_token?: string; refresh_token?: string; expires_in?: string | number };
          website_cookies?: Array<{ Name?: string; Value?: string }>;
          store_authentication_cookie?: Record<string, unknown>;
        };
        extensions?: {
          device_info?: Record<string, unknown>;
          customer_info?: Record<string, unknown>;
        };
      };
    };
    error?: unknown;
  };

  const success = json.response?.success;
  if (!success?.tokens) {
    throw new Error(`Amazon registration failed: ${JSON.stringify(json).slice(0, 400)}`);
  }

  const tokens = success.tokens;
  const adpToken = tokens.mac_dms?.adp_token;
  const rawPrivateKey = tokens.mac_dms?.device_private_key;
  const accessToken = tokens.bearer?.access_token;
  const refreshToken = tokens.bearer?.refresh_token;

  if (!adpToken || !rawPrivateKey || !accessToken || !refreshToken) {
    throw new Error("Amazon registration response was missing tokens");
  }

  const websiteCookies: Record<string, string> = {};
  for (const cookie of tokens.website_cookies ?? []) {
    if (cookie.Name) websiteCookies[cookie.Name] = (cookie.Value ?? "").replace(/^"|"$/g, "");
  }

  const deviceInfo = success.extensions?.device_info ?? {};
  const customerInfo = success.extensions?.customer_info ?? {};
  const expiresIn = Number.parseInt(String(tokens.bearer?.expires_in ?? 3600), 10);

  return {
    adpToken,
    devicePrivateKeyPem: normalizePrivateKey(rawPrivateKey),
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    websiteCookies,
    storeAuthenticationCookie: tokens.store_authentication_cookie,
    customerInfo,
    customerId: typeof customerInfo["user_id"] === "string" ? customerInfo["user_id"] : undefined,
    deviceInfo: {
      deviceName: String(deviceInfo["device_name"] ?? "ClashFLAC"),
      deviceSerialNumber: String(deviceInfo["device_serial_number"] ?? serial),
      deviceType: DEVICE_TYPE.MUSIC,
    },
    accountRegion: region,
  };
}

/** Amazon returns the key either as PEM or as base64 DER; normalise to PEM. */
export function normalizePrivateKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("-----BEGIN")) return trimmed;
  const der = Buffer.from(trimmed, "base64");
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs1" });
  return key.export({ format: "pem", type: "pkcs1" }).toString();
}

export class AmazonAuth {
  credentials: AmazonCredentials | null = null;
  #privateKey: KeyObject | null = null;
  #refreshing: Promise<boolean> | null = null;
  /** Logins awaiting their authorization code, keyed by an opaque id. */
  readonly pending = new Map<string, PendingLogin>();

  isAuthenticated(): boolean {
    return Boolean(this.credentials?.adpToken);
  }

  get region(): AmazonRegion | undefined {
    return this.credentials?.accountRegion;
  }

  get privateKey(): KeyObject {
    if (!this.credentials) throw new Error("Amazon Music is not authenticated.");
    this.#privateKey ??= createPrivateKey(this.credentials.devicePrivateKeyPem);
    return this.#privateKey;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(config.amazon.credentialsFile, "utf8").catch(() => null);
      if (raw === null) return;
      const data = JSON.parse(raw) as AmazonCredentials | Record<string, AmazonCredentials>;
      // The store may hold a single account or a map keyed by customer id.
      const candidate =
        "adpToken" in data ? (data as AmazonCredentials) : Object.values(data)[0];
      if (candidate?.adpToken) {
        this.credentials = candidate;
        log.info(`loaded Amazon credentials for ${candidate.customerId ?? "unknown customer"}`);
      }
    } catch (err) {
      log.warn(`could not read Amazon credentials: ${String(err)}`);
    }
  }

  async save(): Promise<void> {
    if (!this.credentials) return;
    try {
      await mkdir(dirname(config.amazon.credentialsFile), { recursive: true });
      await writeFile(config.amazon.credentialsFile, JSON.stringify(this.credentials, null, 2), "utf8");
    } catch (err) {
      log.warn(`could not persist Amazon credentials: ${String(err)}`);
    }
  }

  /** Begin a login. Returns the id to pass back with the redirect URL. */
  startLogin(country = "US"): { loginId: string; oauthUrl: string } {
    const loginId = randomBytes(12).toString("hex");
    const pending = buildLoginUrl(country);
    this.pending.set(loginId, pending);

    // Expire stale logins so the map cannot grow without bound.
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, entry] of this.pending) {
      if (entry.createdAt < cutoff) this.pending.delete(id);
    }

    return { loginId, oauthUrl: pending.oauthUrl };
  }

  async completeLogin(loginId: string, redirectUrl: string): Promise<AmazonCredentials> {
    const pending = this.pending.get(loginId);
    if (!pending) throw new Error("Unknown or expired login id; start the login again.");

    const code = extractAuthorizationCode(redirectUrl);
    if (!code) throw new Error("Could not find an authorization code in that URL.");

    const credentials = await registerDevice(pending, code);
    this.credentials = credentials;
    this.#privateKey = null;
    this.pending.delete(loginId);
    await this.save();
    log.info("Amazon Music device registered");
    return credentials;
  }

  /**
   * Sign a request the way Amazon's device API requires:
   * base64(RSA-SHA256(METHOD\npath\ndate\nbody\nadpToken)).
   */
  signHeaders(method: string, path: string, body: string): Record<string, string> {
    if (!this.credentials) throw new Error("Amazon Music is not authenticated.");
    const date = `${new Date().toISOString().replace(/\.\d{3}Z$/, "")}Z`;
    const payload = `${method}\n${path}\n${date}\n${body}\n${this.credentials.adpToken}`;

    const signature = createSign("RSA-SHA256").update(payload).sign(this.privateKey, "base64");

    return {
      "x-adp-token": this.credentials.adpToken,
      "x-adp-alg": "SHA256withRSA:1.0",
      "x-adp-signature": `${signature}:${date}`,
    };
  }

  cookieHeader(): string {
    if (!this.credentials) return "";
    return Object.entries(this.credentials.websiteCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async ensureFreshToken(): Promise<void> {
    if (!this.credentials) throw new Error("Amazon Music is not authenticated.");
    if (Date.now() < this.credentials.expiresAt - 60_000) return;
    await this.refresh();
  }

  async refresh(): Promise<boolean> {
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<boolean> {
    const credentials = this.credentials;
    if (!credentials?.refreshToken) return false;
    try {
      const res = await request(`https://api.amazon.${credentials.accountRegion.domainTld}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": WEB_USER_AGENT },
        body: JSON.stringify({
          app_name: "com.amazon.mp3",
          app_version: "523160014",
          source_token_type: "refresh_token",
          source_token: credentials.refreshToken,
          requested_token_type: "access_token",
        }),
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        log.warn(`Amazon token refresh failed: HTTP ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number | string };
      if (!data.access_token) return false;

      credentials.accessToken = data.access_token;
      credentials.expiresAt = Date.now() + Number.parseInt(String(data.expires_in ?? 3600), 10) * 1000;
      await this.save();
      log.info("refreshed Amazon access token");
      return true;
    } catch (err) {
      log.warn(`Amazon token refresh error: ${String(err)}`);
      return false;
    }
  }

  logout(): void {
    this.credentials = null;
    this.#privateKey = null;
  }
}
