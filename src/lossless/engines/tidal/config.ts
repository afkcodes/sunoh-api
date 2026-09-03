import { config } from "../../config";

export const TIDAL_API_URL = "https://api.tidal.com/v1";
export const TIDAL_AUTH_URL = "https://auth.tidal.com/v1/oauth2";

export interface TidalClientKey {
  platform: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

/**
 * OAuth client pairs, carried over from tidal/config.py. These are the
 * community-published device clients the original project used; supply
 * TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET to override with your own.
 */
export const CLIENT_KEYS: readonly TidalClientKey[] = [
  {
    platform: "TIDAL HiFi / Lossless",
    clientId: "fX2JxdmntZWK0ixT",
    clientSecret: "1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=",
    scope: "r_usr+w_usr+w_sub",
  },
  {
    platform: "Fire TV (Master/HiFi)",
    clientId: "7m7Ap0JC9j1cOM3n",
    clientSecret: "vRAdA108tlvkJpTsGZS8rGZ7xTlbJ0qaZ2K9saEzsgY=",
    scope: "r_usr+w_usr+w_sub",
  },
  {
    platform: "Android TV (HiFi)",
    clientId: "Pzd0ExNVHkyZLiYN",
    clientSecret: "W7X6UvBaho+XOi1MUeCX6ewv2zTdSOV3Y7qC3p3675I=",
    scope: "r_usr+w_usr+w_sub",
  },
  {
    platform: "Fire TV (Standard)",
    clientId: "OmDtrzFgyVVL6uW56OnFA2COiabqm",
    clientSecret: "zxen1r3pO0hgtOC7j6twMo9UAqngGrmRiWpV7QC1zJ8=",
    scope: "r_usr+w_usr+w_sub",
  },
];

export function primaryClientKey(): TidalClientKey {
  if (config.tidal.clientId) {
    return {
      platform: "Custom",
      clientId: config.tidal.clientId,
      clientSecret: config.tidal.clientSecret,
      scope: "r_usr+w_usr+w_sub",
    };
  }
  return CLIENT_KEYS[0]!;
}

/** Tidal's unified tier serves genuine FLAC through HI_RES_LOSSLESS. */
export const QUALITY_MAP: Readonly<Record<string, string>> = {
  LOW: "LOW",
  HIGH: "HIGH",
  HD: "HI_RES_LOSSLESS",
  UHD: "HI_RES_LOSSLESS",
  LOSSLESS: "HI_RES_LOSSLESS",
  HI_RES: "HI_RES_LOSSLESS",
  HI_RES_LOSSLESS: "HI_RES_LOSSLESS",
  MASTER: "HI_RES_LOSSLESS",
};

export function mapQuality(quality?: string): string {
  return QUALITY_MAP[(quality ?? "UHD").toUpperCase()] ?? "HI_RES_LOSSLESS";
}

/** Fallback ladder when the requested tier is not entitled. */
export const QUALITY_FALLBACK = ["HI_RES_LOSSLESS", "LOSSLESS", "HIGH", "LOW"] as const;

export const TOKEN_FILE = "./config/tidal-tokens.json";

export function coverUrl(coverId: string | undefined, size = "1280x1280"): string | undefined {
  if (!coverId) return undefined;
  // Tidal cover ids are UUIDs whose dashes become path separators.
  return `https://resources.tidal.com/images/${coverId.replace(/-/g, "/")}/${size}.jpg`;
}
