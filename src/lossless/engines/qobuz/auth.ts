import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../../config";
import { request } from "../../lib/http";
import { logger } from "../../lib/logger";
import { FALLBACK_APP_IDS, KNOWN_SECRETS, QOBUZ_API_BASE, QOBUZ_WEB_PLAYER } from "./config";

const log = logger.child("qobuz.auth");

const TOKEN_FILE = "./config/qobuz-tokens.json";

const SEED_TIMEZONE_RE = /[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g;
const APP_ID_RE = /production:\{api:\{appId:"(\d{9})",appSecret:"\w{32}"/;
const BUNDLE_URL_RE = /<script src="(\/resources\/\d+\.\d+\.\d+-[a-z]\d{3}\/bundle\.js)"><\/script>/;

export interface QobuzAccount {
  email?: string;
  userAuthToken: string;
  userId?: string;
  membership?: string;
}

export interface QobuzTokenStore {
  appId?: string;
  appSecret?: string;
  accounts?: QobuzAccount[];
}

export class QobuzAuth {
  appId: string;
  appSecret: string | undefined;
  accounts: QobuzAccount[] = [];
  private index = 0;
  /** Secrets discovered at runtime, tried after the configured one. */
  readonly scraped = new Set<string>();
  private bundlePromise: Promise<{ appId?: string; secrets: string[] }> | null = null;

  constructor() {
    this.appId = config.qobuz.appId;
    this.appSecret = config.qobuz.appSecret || KNOWN_SECRETS[0];
    this.accounts = config.qobuz.accounts.map((a) => ({
      email: a.email,
      userAuthToken: a.user_auth_token,
      userId: a.user_id,
    }));
  }

  get current(): QobuzAccount | undefined {
    return this.accounts[this.index];
  }

  get userAuthToken(): string | undefined {
    return this.current?.userAuthToken;
  }

  get userId(): string | undefined {
    return this.current?.userId;
  }

  isAuthenticated(): boolean {
    return Boolean(this.userAuthToken);
  }

  /** Move to the next account in the pool. Returns false when exhausted. */
  rotate(): boolean {
    if (this.accounts.length <= 1) return false;
    this.index = (this.index + 1) % this.accounts.length;
    log.warn(`rotated to Qobuz account ${this.index + 1}/${this.accounts.length}`);
    return true;
  }

  /** Load any persisted tokens, merging them under the env-supplied values. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(TOKEN_FILE, "utf8").catch(() => null);
      if (raw === null) return;
      const data = JSON.parse(raw) as QobuzTokenStore;
      this.appId ||= data.appId ?? "";
      this.appSecret ||= data.appSecret;
      for (const account of data.accounts ?? []) {
        if (!account.userAuthToken) continue;
        if (this.accounts.some((a) => a.userAuthToken === account.userAuthToken)) continue;
        this.accounts.push(account);
      }
      log.info(`loaded ${this.accounts.length} Qobuz account(s)`);
    } catch (err) {
      log.warn(`could not read ${TOKEN_FILE}: ${String(err)}`);
    }
  }

  async save(): Promise<void> {
    try {
      await mkdir(dirname(TOKEN_FILE), { recursive: true });
      const store: QobuzTokenStore = {
        appId: this.appId,
        appSecret: this.appSecret,
        accounts: this.accounts,
      };
      await writeFile(TOKEN_FILE, JSON.stringify(store, null, 2), "utf8");
    } catch (err) {
      log.warn(`could not persist Qobuz tokens: ${String(err)}`);
    }
  }

  /** Every secret worth trying when signing, most-likely first. */
  secrets(): string[] {
    return [...new Set([this.appSecret, ...KNOWN_SECRETS].filter((s): s is string => Boolean(s)))];
  }

  appIdCandidates(): string[] {
    return [...new Set([this.appId, ...FALLBACK_APP_IDS].filter(Boolean))];
  }

  /**
   * Scrape an app id and the signing secrets out of the public web player
   * bundle. Qobuz rotates these, so they are derived at runtime rather than
   * hard-coded, and the result is cached for the process lifetime.
   */
  async fetchBundleTokens(): Promise<{ appId?: string; secrets: string[] }> {
    this.bundlePromise ??= this.#scrapeBundle().catch((err) => {
      this.bundlePromise = null;
      throw err;
    });
    return this.bundlePromise;
  }

  async #scrapeBundle(): Promise<{ appId?: string; secrets: string[] }> {
    const loginPage = await request(`${QOBUZ_WEB_PLAYER}/login`, { timeoutMs: 12_000 });
    const html = await loginPage.text();
    const bundlePath = BUNDLE_URL_RE.exec(html)?.[1];
    if (!bundlePath) throw new Error("Could not locate bundle.js on the Qobuz login page");

    const bundleRes = await request(`${QOBUZ_WEB_PLAYER}${bundlePath}`, { timeoutMs: 25_000 });
    if (!bundleRes.ok) throw new Error(`Qobuz bundle fetch failed: ${bundleRes.status}`);
    const bundle = await bundleRes.text();

    const appId = APP_ID_RE.exec(bundle)?.[1];

    // Each timezone contributes a seed plus an info/extras pair; concatenated
    // and base64-decoded (minus a 44-character tail) they form one secret.
    const seeds = new Map<string, string[]>();
    for (const m of bundle.matchAll(SEED_TIMEZONE_RE)) {
      const [, seed, timezone] = m;
      if (seed && timezone) seeds.set(timezone, [seed]);
    }

    const timezones = [...seeds.keys()];
    if (timezones.length > 1) {
      // Upstream moves the second timezone to the front; the ordering decides
      // which secret is tried first.
      const [first, second, ...rest] = timezones;
      if (first && second) {
        const reordered = [second, first, ...rest];
        const remapped = new Map<string, string[]>();
        for (const tz of reordered) remapped.set(tz, seeds.get(tz)!);
        seeds.clear();
        for (const [k, v] of remapped) seeds.set(k, v);
      }
    }

    const tzPattern = [...seeds.keys()]
      .map((tz) => tz.charAt(0).toUpperCase() + tz.slice(1))
      .join("|");
    if (tzPattern) {
      const infoRe = new RegExp(
        String.raw`name:"\w+/(${tzPattern})",info:"([\w=]+)",extras:"([\w=]+)"`,
        "g",
      );
      for (const m of bundle.matchAll(infoRe)) {
        const [, timezone, info, extras] = m;
        if (!timezone || !info || !extras) continue;
        seeds.get(timezone.toLowerCase())?.push(info, extras);
      }
    }

    const secrets: string[] = [];
    for (const parts of seeds.values()) {
      try {
        const joined = parts.join("");
        if (joined.length <= 44) continue;
        const decoded = Buffer.from(joined.slice(0, -44), "base64").toString("utf8");
        if (decoded) secrets.push(decoded);
      } catch {
        // A malformed seed just means one fewer secret to try.
      }
    }

    log.info(`scraped Qobuz bundle: appId=${appId ?? "none"}, ${secrets.length} secret(s)`);
    return { appId, secrets };
  }

  /**
   * Fill in whatever credentials are missing and collect fallback secrets.
   *
   * The scrape runs even when an app id and secret are already configured.
   * Qobuz rotates its signing secrets, so a configured one can be stale, and
   * without the scraped alternatives the signer has nothing else to try -- the
   * request then fails with a bare HTTP 400 that looks like a bad token.
   * The underlying fetch is cached for the process lifetime, so this costs one
   * request in total, not one per call.
   */
  async ensureCredentials(): Promise<void> {
    // Only skip entirely once the scrape has already contributed its secrets.
    if (this.appId && this.appSecret && this.scraped.size > 0) return;
    try {
      const { appId, secrets } = await this.fetchBundleTokens();
      this.appId ||= appId ?? "";
      this.appSecret ||= secrets[0];
      for (const s of secrets) if (!KNOWN_SECRETS.includes(s)) this.scraped.add(s);
    } catch (err) {
      log.warn(`Qobuz bundle scrape failed: ${String(err)}`);
    }
  }

  allSecrets(): string[] {
    return [...new Set([...this.secrets(), ...this.scraped])];
  }

  async login(email: string, password: string, appId?: string): Promise<QobuzAccount> {
    await this.ensureCredentials();
    const targetAppId = appId || this.appId;
    if (!targetAppId) throw new Error("No Qobuz app id available; set QOBUZ_APP_ID.");

    const res = await request(`${QOBUZ_API_BASE}user/login`, {
      query: { email, password, app_id: targetAppId },
      headers: { "X-App-Id": targetAppId },
      timeoutMs: 12_000,
    });
    if (res.status === 401) throw new Error("Invalid Qobuz email or password.");
    if (res.status === 400) throw new Error("Invalid Qobuz app id.");
    if (!res.ok) throw new Error(`Qobuz login failed: HTTP ${res.status}`);

    const data = (await res.json()) as {
      user_auth_token?: string;
      user?: { id?: number | string; credential?: { parameters?: { short_label?: string; label?: string } } };
    };
    if (!data.user_auth_token) throw new Error("Qobuz login returned no auth token.");

    const params = data.user?.credential?.parameters;
    const account: QobuzAccount = {
      email,
      userAuthToken: data.user_auth_token,
      userId: data.user?.id !== undefined ? String(data.user.id) : undefined,
      membership: params?.short_label || params?.label || "Lossless",
    };

    this.appId = targetAppId;
    const existing = this.accounts.findIndex((a) => a.email === email);
    if (existing >= 0) this.accounts[existing] = account;
    else this.accounts.push(account);
    this.index = existing >= 0 ? existing : this.accounts.length - 1;

    await this.save();
    return account;
  }

  logout(): void {
    this.accounts = [];
    this.index = 0;
  }
}
