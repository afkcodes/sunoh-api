export const QOBUZ_API_BASE = "https://www.qobuz.com/api.json/0.2/";
export const QOBUZ_WEB_PLAYER = "https://play.qobuz.com";

/**
 * Qobuz format ids.
 *   5  MP3 320 kbps
 *   6  FLAC 16-bit / 44.1 kHz (CD lossless)
 *   7  FLAC 24-bit up to 96 kHz
 *   27 FLAC 24-bit above 96 kHz (up to 192 kHz)
 */
export const QUALITY_FORMAT_MAP: Readonly<Record<string, number>> = {
  LOW: 5, MP3: 5, HIGH: 5,
  HD: 6, CD: 6, LOSSLESS: 6,
  UHD: 27, HI_RES: 27, HI_RES_LOSSLESS: 27, MASTER: 27,
};

/** Preference order when the requested format is unavailable. */
export const FORMAT_FALLBACK_ORDER = [27, 7, 6, 5] as const;

export const LOSSLESS_FORMAT_IDS = new Set([6, 7, 27]);

/**
 * App ids to try when the configured one is rejected.
 *
 * The upstream Python referenced QobuzConfig.FALLBACK_APP_IDS and
 * QobuzConfig.KNOWN_SECRETS without ever defining them, so any code path
 * reaching them raised AttributeError. They are defined here, and left empty
 * rather than shipping harvested credentials -- populate via env, or let
 * fetchBundleTokens() scrape a working pair from the public web player.
 */
export const FALLBACK_APP_IDS: readonly string[] = [];
export const KNOWN_SECRETS: readonly string[] = [];

export function getFormatId(quality?: string): number {
  return QUALITY_FORMAT_MAP[(quality ?? "UHD").toUpperCase()] ?? 27;
}

export function isLossless(formatId: number | undefined): boolean {
  return formatId !== undefined && LOSSLESS_FORMAT_IDS.has(formatId);
}
