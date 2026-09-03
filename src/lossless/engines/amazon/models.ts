/** Amazon Music regions, device constants and the credential shape. */

export type Continent = "NA" | "EU" | "FE";

export interface AmazonRegion {
  region: Continent;
  country: string;
  marketplaceId: string;
  prettyName: string;
  locale: string;
  domainTld: string;
}

/** Device type ids per Amazon mobile application. */
export const DEVICE_TYPE = {
  MUSIC: "A1DL2DVDQVK3Q",
  PRIME_VIDEO: "A43PXU4ZN2AL1",
  SHOPPING: "A1MPSLFC7L5AFK",
} as const;

export const ASSOC_HANDLE = {
  MUSIC: "amzn_tiburon_na",
  PRIME_VIDEO: "amzn_piv_android_v2_us",
} as const;

/**
 * The subset of Amazon Music regions carried over from amazonmusic/models.py.
 * Marketplace ids repeat across countries that share a storefront.
 */
const REGION_TABLE: Record<Continent, Array<[string, string, string, string, string]>> = {
  NA: [
    ["US", "ATVPDKIKX0DER", "United States of America", "en_US", "com"],
    ["CA", "A2EUQ1WTGCTBG2", "Canada", "en_CA", "ca"],
    ["MX", "A1AM78C64UM0Y8", "Mexico", "es_MX", "com.mx"],
    ["BR", "A2Q3Y263D00KWC", "Brazil", "es_BR", "com.br"],
    ["AR", "ATVPDKIKX0DER", "Argentina", "es_AR", "com"],
    ["CL", "ATVPDKIKX0DER", "Chile", "es_CL", "com"],
    ["CO", "ATVPDKIKX0DER", "Colombia", "es_CO", "com"],
  ],
  EU: [
    ["NL", "A1805IZSGTT6HS", "Netherlands", "nl_NL", "com"],
    ["IN", "A21TJRUUN4KGV", "India", "hi_IN", "in"],
    ["GB", "A1F83G8C2ARO7P", "United Kingdom", "en_GB", "co.uk"],
    ["ES", "A1RKKUPIHCS9HS", "Spain", "es_ES", "es"],
    ["FR", "A13V1IB3VIYZZH", "France", "fr_FR", "fr"],
    ["IT", "APJ6JRA9NG5V4", "Italy", "it_IT", "it"],
    ["DE", "A1PA6795UKMFR9", "Germany", "de_DE", "de"],
    ["AT", "A1PA6795UKMFR9", "Austria", "de_AT", "de"],
    ["BE", "ATVPDKIKX0DER", "Belgium", "fr_BE", "com"],
    ["IE", "A1F83G8C2ARO7P", "Ireland", "en_IE", "co.uk"],
  ],
  FE: [
    ["JP", "A1VC38T7YXB528", "Japan", "ja_JP", "co.jp"],
    ["AU", "A39IBJ37TRP1C6", "Australia", "en_AU", "com.au"],
    ["NZ", "A39IBJ37TRP1C6", "New Zealand", "en_NZ", "com.au"],
  ],
};

let cachedRegions: AmazonRegion[] | null = null;

export function knownRegions(): AmazonRegion[] {
  cachedRegions ??= Object.entries(REGION_TABLE).flatMap(([continent, rows]) =>
    rows.map(([country, marketplaceId, prettyName, locale, domainTld]) => ({
      region: continent as Continent,
      country,
      marketplaceId,
      prettyName,
      locale,
      domainTld,
    })),
  );
  return cachedRegions;
}

export function regionFor(country: string): AmazonRegion {
  const found = knownRegions().find((r) => r.country === country.toUpperCase());
  if (!found) throw new Error(`Unsupported Amazon Music region "${country}"`);
  return found;
}

export interface AmazonDeviceInfo {
  deviceName: string;
  deviceSerialNumber: string;
  deviceType: string;
}

/**
 * Persisted credentials.
 *
 * The Python stored these as a pickle of a dataclass; this is the JSON
 * equivalent, so the private key travels as PEM text rather than an rsa object.
 */
export interface AmazonCredentials {
  adpToken: string;
  /** PEM-encoded RSA private key used to sign every API request. */
  devicePrivateKeyPem: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  websiteCookies: Record<string, string>;
  storeAuthenticationCookie?: Record<string, unknown>;
  customerInfo?: Record<string, unknown>;
  customerId?: string;
  deviceInfo: AmazonDeviceInfo;
  accountRegion: AmazonRegion;
  tier?: "FREE" | "PRIME" | "UNLIMITED";
}

/** Content tiers Amazon expects per subscription level. */
export const CONTENT_TIERS: Record<string, string[]> = {
  FREE: ["NIGHTWING_CONTENT", "OWNED_CONTENT"],
  PRIME: ["ROBIN_CONTENT", "SONIC_CONTENT", "NIGHTWING_CONTENT", "OWNED_CONTENT"],
  UNLIMITED: ["KATANA_CONTENT", "HAWKFIRE_CONTENT", "NIGHTWING_CONTENT", "OWNED_CONTENT"],
};

export const APP_VERSION = "9.19.1";
export const HARLEY_VERSION = "1.0";
export const APP_USER_AGENT = `Amazon Music/${APP_VERSION} (Android 13; Pixel 5)`;
export const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
