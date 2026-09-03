/**
 * Environment configuration for the lossless engines.
 *
 * Every value is read through a getter rather than captured when this module is
 * first required. `dev-server.ts` calls `dotenv.config()` *after* its imports,
 * and imports evaluate first, so an eager literal here would snapshot an empty
 * environment and every engine would report itself unconfigured. Reading lazily
 * makes the load order irrelevant. (Bun auto-loads .env before anything runs,
 * which is why this only bites on Node.)
 */

function str(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

function int(key: string, fallback: number): number {
  const n = Number.parseInt(str(key), 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback = false): boolean {
  const v = str(key).toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

export interface QobuzAccount {
  email?: string;
  user_auth_token: string;
  user_id?: string;
}

function qobuzAccounts(): QobuzAccount[] {
  const raw = str('QOBUZ_ACCOUNTS_JSON');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (a): a is QobuzAccount =>
            !!a && typeof a === 'object' && typeof (a as QobuzAccount).user_auth_token === 'string',
        );
      }
    } catch {
      // Fall through to the single-account variables below.
    }
  }
  const token = str('QOBUZ_USER_AUTH_TOKEN');
  return token
    ? [
        {
          email: str('QOBUZ_EMAIL') || undefined,
          user_auth_token: token,
          user_id: str('QOBUZ_USER_ID') || undefined,
        },
      ]
    : [];
}

export const config = {
  get port(): number {
    return int('PORT', 3600);
  },
  get logLevel(): string {
    return str('LOG_LEVEL', 'info');
  },
  get downloadDir(): string {
    return str('DOWNLOAD_DIR', './downloads');
  },
  get maxConcurrentDownloads(): number {
    return int('MAX_CONCURRENT_DOWNLOADS', 2);
  },

  get qobuz() {
    return {
      appId: str('QOBUZ_APP_ID'),
      appSecret: str('QOBUZ_APP_SECRET'),
      accounts: qobuzAccounts(),
    };
  },

  get tidal() {
    return {
      clientId: str('TIDAL_CLIENT_ID'),
      clientSecret: str('TIDAL_CLIENT_SECRET'),
      accessToken: str('TIDAL_ACCESS_TOKEN'),
      refreshToken: str('TIDAL_REFRESH_TOKEN'),
      userId: str('TIDAL_USER_ID'),
      countryCode: str('TIDAL_COUNTRY_CODE', 'US'),
    };
  },

  get amazon() {
    return {
      credentialsFile: str('AMZ_CREDENTIALS_FILE', './config/amazon-credentials.json'),
      wvdPath: str('AMZ_WVD_PATH'),
    };
  },

  get spotify() {
    return {
      clientId: str('SPOTIFY_CLIENT_ID'),
      clientSecret: str('SPOTIFY_CLIENT_SECRET'),
    };
  },

  get turnstile() {
    return {
      siteKey: str('CLOUDFLARE_SITE_KEY'),
      secretKey: str('CLOUDFLARE_SECRET_KEY'),
      enforce: bool('TURNSTILE_ENFORCE', false),
    };
  },

  get mapper() {
    return {
      musicbrainzContact: str('MUSICBRAINZ_CONTACT', 'sunoh-api@example.com'),
    };
  },
};

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
