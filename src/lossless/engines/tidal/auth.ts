import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../../config";
import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { TIDAL_AUTH_URL, TOKEN_FILE, primaryClientKey } from "./config";

const log = logger.child("tidal.auth");

export interface TidalSession {
  accessToken: string;
  refreshToken?: string;
  userId?: string;
  countryCode: string;
  expiresAt?: number;
  clientId: string;
  clientSecret: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export class TidalAuth {
  session: TidalSession | null = null;
  #refreshing: Promise<boolean> | null = null;

  constructor() {
    const key = primaryClientKey();
    if (config.tidal.accessToken) {
      this.session = {
        accessToken: config.tidal.accessToken,
        refreshToken: config.tidal.refreshToken || undefined,
        userId: config.tidal.userId || undefined,
        countryCode: config.tidal.countryCode || "US",
        clientId: key.clientId,
        clientSecret: key.clientSecret,
      };
    }
  }

  isAuthenticated(): boolean {
    return Boolean(this.session?.accessToken);
  }

  get countryCode(): string {
    return this.session?.countryCode ?? config.tidal.countryCode ?? "US";
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(TOKEN_FILE, "utf8").catch(() => null);
      if (raw === null) return;
      const data = JSON.parse(raw) as Partial<TidalSession>;
      if (!data.accessToken) return;
      const key = primaryClientKey();
      // Env-supplied tokens win, so a deploy can override the on-disk store.
      this.session ??= {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        userId: data.userId,
        countryCode: data.countryCode ?? "US",
        expiresAt: data.expiresAt,
        clientId: data.clientId ?? key.clientId,
        clientSecret: data.clientSecret ?? key.clientSecret,
      };
      log.info("loaded Tidal session from disk");
    } catch (err) {
      log.warn(`could not read ${TOKEN_FILE}: ${String(err)}`);
    }
  }

  async save(): Promise<void> {
    if (!this.session) return;
    try {
      await mkdir(dirname(TOKEN_FILE), { recursive: true });
      await writeFile(TOKEN_FILE, JSON.stringify(this.session, null, 2), "utf8");
    } catch (err) {
      log.warn(`could not persist Tidal tokens: ${String(err)}`);
    }
  }

  /** Start the device-code flow; the user then visits the returned URI. */
  async startDeviceAuthorization(): Promise<DeviceAuthorization> {
    const key = primaryClientKey();
    const res = await request(`${TIDAL_AUTH_URL}/device_authorization`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: key.clientId, scope: key.scope }).toString(),
      timeoutMs: 15_000,
    });
    if (!res.ok) throw new Error(`Tidal device authorization failed: HTTP ${res.status}`);

    const data = (await res.json()) as {
      deviceCode?: string;
      userCode?: string;
      verificationUri?: string;
      verificationUriComplete?: string;
      expiresIn?: number;
      interval?: number;
    };
    if (!data.deviceCode || !data.userCode) throw new Error("Tidal returned no device code.");

    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUriComplete
        ? `https://${data.verificationUriComplete}`
        : `https://${data.verificationUri ?? "link.tidal.com"}`,
      expiresIn: data.expiresIn ?? 300,
      interval: data.interval ?? 2,
    };
  }

  /**
   * Poll once for completion of a device authorization.
   * Returns null while the user has not yet approved, which is not an error.
   */
  async pollDeviceAuthorization(deviceCode: string): Promise<TidalSession | null> {
    const key = primaryClientKey();
    const res = await request(`${TIDAL_AUTH_URL}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth(key.clientId, key.clientSecret),
      },
      body: new URLSearchParams({
        client_id: key.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        scope: key.scope,
      }).toString(),
      timeoutMs: 15_000,
      retries: 0,
    });

    if (res.status === 400) return null; // authorization_pending
    if (!res.ok) throw new Error(`Tidal token exchange failed: HTTP ${res.status}`);

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user?: { userId?: number | string; countryCode?: string };
    };
    if (!data.access_token) return null;

    this.session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user?.userId !== undefined ? String(data.user.userId) : undefined,
      countryCode: data.user?.countryCode ?? config.tidal.countryCode ?? "US",
      expiresAt: Date.now() + (data.expires_in ?? 604_800) * 1000,
      clientId: key.clientId,
      clientSecret: key.clientSecret,
    };
    await this.save();
    log.info(`Tidal authenticated as user ${this.session.userId ?? "unknown"}`);
    return this.session;
  }

  /** Exchange the refresh token for a new access token. */
  async refresh(): Promise<boolean> {
    if (!this.session?.refreshToken) return false;
    // Collapse concurrent refreshes so a burst of 401s triggers only one call.
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<boolean> {
    const session = this.session;
    if (!session?.refreshToken) return false;
    try {
      const res = await request(`${TIDAL_AUTH_URL}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: basicAuth(session.clientId, session.clientSecret),
        },
        body: new URLSearchParams({
          client_id: session.clientId,
          refresh_token: session.refreshToken,
          grant_type: "refresh_token",
          scope: "r_usr+w_usr+w_sub",
        }).toString(),
        timeoutMs: 15_000,
      });
      if (!res.ok) {
        log.warn(`Tidal refresh failed: HTTP ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return false;

      session.accessToken = data.access_token;
      session.expiresAt = Date.now() + (data.expires_in ?? 604_800) * 1000;
      await this.save();
      log.info("refreshed Tidal access token");
      return true;
    } catch (err) {
      log.warn(`Tidal refresh error: ${String(err)}`);
      return false;
    }
  }

  setToken(accessToken: string, opts: { refreshToken?: string; userId?: string; countryCode?: string } = {}): void {
    const key = primaryClientKey();
    this.session = {
      accessToken,
      refreshToken: opts.refreshToken,
      userId: opts.userId,
      countryCode: opts.countryCode ?? config.tidal.countryCode ?? "US",
      clientId: key.clientId,
      clientSecret: key.clientSecret,
    };
  }

  logout(): void {
    this.session = null;
  }
}
