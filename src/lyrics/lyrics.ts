import * as https from 'https';
import { DOMParser } from 'xmldom';

interface AppleMusicConfig {
  languageCode: string;
  countryCode: string;
  timeout: number;
  maxRetries: number;
  enableDebug: boolean;
}

interface AppleMusicOptions {
  languageCode?: string;
  countryCode?: string;
  timeout?: number;
  maxRetries?: number;
  enableDebug?: boolean;
}

interface SearchOptions {
  limit?: number;
}

interface FetchOptions {
  language?: string;
  format?: 'lrc' | 'ttml';
}

interface SearchResult {
  trackId: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  previewUrl: string;
  artworkUrl: string;
  releaseDate: string;
  isLyricsAvailable: boolean;
}

interface TimeObject {
  m: number;
  s: number;
  ms: number;
}

/**
 * Apple Music Lyrics Fetcher
 * Simplified version with only essential methods: searchAppleMusic and fetchLyricsWithAuth
 */
class AppleMusicLyricsLRC {
  private config: AppleMusicConfig;

  constructor(options: AppleMusicOptions = {}) {
    this.config = {
      languageCode: options.languageCode || 'en-IN',
      countryCode: options.countryCode || 'in',
      timeout: options.timeout || 10000,
      maxRetries: options.maxRetries || 3,
      enableDebug: options.enableDebug || false,
    };
  }

  /**
   * Debug logging
   */
  private _debug(...args: any[]): void {
    if (this.config.enableDebug) {
      console.log('[AMLyrics]', ...args);
    }
  }

  /**
   * Check if text contains CJK characters (Chinese, Japanese, Korean)
   */
  private _containsCJK(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const code = text.codePointAt(i);
      if (
        (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
        (code >= 0x2e80 && code <= 0x2eff) || // CJK Radicals Supplement
        (code >= 0x2f00 && code <= 0x2fdf) || // Kangxi Radicals
        (code >= 0x2ff0 && code <= 0x2fff) || // Ideographic Description Characters
        (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
        (code >= 0x3040 && code <= 0x309f) || // Hiragana
        (code >= 0x30a0 && code <= 0x30ff) || // Katakana
        (code >= 0x3130 && code <= 0x318f) || // Hangul Compatibility Jamo
        (code >= 0x31c0 && code <= 0x31ef) || // CJK Strokes
        (code >= 0x31f0 && code <= 0x31ff) || // Katakana Phonetic Extensions
        (code >= 0x3200 && code <= 0x32ff) || // Enclosed CJK Letters and Months
        (code >= 0x3300 && code <= 0x33ff) || // CJK Compatibility
        (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ideographs Extension A
        (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
        (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
        (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
        (code >= 0xd7b0 && code <= 0xd7ff) || // Hangul Jamo Extended-B
        (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
        (code >= 0xfe30 && code <= 0xfe4f) || // CJK Compatibility Forms
        (code >= 0xff65 && code <= 0xff9f) || // Halfwidth Katakana
        (code >= 0xffa0 && code <= 0xffdc) || // Halfwidth Jamo
        (code >= 0x1aff0 && code <= 0x1afff) || // Kana Extended-B
        (code >= 0x1b000 && code <= 0x1b0ff) || // Kana Supplement
        (code >= 0x1b100 && code <= 0x1b12f) || // Kana Extended-A
        (code >= 0x1b130 && code <= 0x1b16f) || // Small Kana Extension
        (code >= 0x1f200 && code <= 0x1f2ff) || // Enclosed Ideographic Supplement
        (code >= 0x20000 && code <= 0x2a6df) || // CJK Unified Ideographs Extension B
        (code >= 0x2a700 && code <= 0x2b73f) || // CJK Unified Ideographs Extension C
        (code >= 0x2b740 && code <= 0x2b81f) || // CJK Unified Ideographs Extension D
        (code >= 0x2b820 && code <= 0x2ceaf) || // CJK Unified Ideographs Extension E
        (code >= 0x2ceb0 && code <= 0x2ebef) || // CJK Unified Ideographs Extension F
        (code >= 0x2ebf0 && code <= 0x2ee5f) || // CJK Unified Ideographs Extension I
        (code >= 0x2f800 && code <= 0x2fa1f) || // CJK Compatibility Ideographs Supplement
        (code >= 0x30000 && code <= 0x3134f) || // CJK Unified Ideographs Extension G
        (code >= 0x31350 && code <= 0x323af)
      ) {
        // CJK Unified Ideographs Extension H
        return true;
      }
    }
    return false;
  }

  /**
   * Parse time string to seconds with milliseconds
   */
  private _parseTimeToSeconds(timeStr: string): TimeObject {
    if (!timeStr) return { m: 0, s: 0, ms: 0 };

    let h = 0,
      m = 0,
      s = 0,
      ms = 0;

    if (timeStr.includes(':')) {
      if (timeStr.match(/\d+:\d+:\d+\.\d+/)) {
        const parts = timeStr.match(/(\d+):(\d+):(\d+)\.(\d+)/);
        h = parseInt(parts[1]);
        m = parseInt(parts[2]);
        s = parseInt(parts[3]);
        ms = parseInt(parts[4]);
      } else if (timeStr.match(/\d+:\d+\.\d+/)) {
        const parts = timeStr.match(/(\d+):(\d+)\.(\d+)/);
        m = parseInt(parts[1]);
        s = parseInt(parts[2]);
        ms = parseInt(parts[3]);
      } else if (timeStr.match(/\d+:\d+/)) {
        const parts = timeStr.match(/(\d+):(\d+)/);
        m = parseInt(parts[1]);
        s = parseInt(parts[2]);
      }
    } else {
      const parts = timeStr.match(/(\d+)\.(\d+)/);
      if (parts) {
        s = parseInt(parts[1]);
        ms = parseInt(parts[2]);
      }
    }

    const totalMinutes = h * 60 + m;
    const milliseconds = ms / 10; // Convert to centiseconds
    return { m: totalMinutes, s, ms: Math.floor(milliseconds) };
  }

  /**
   * Format time for LRC with different types
   */
  private _formatLRCTime(timeObj: TimeObject, type: string = 'standard'): string {
    const { m, s, ms } = timeObj;
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    const msStr = ms.toString().padStart(2, '0');

    switch (type) {
      case 'standard':
        return `[${mm}:${ss}.${msStr}]`;
      case 'enhanced_start':
        return `[${mm}:${ss}.${msStr}]<${mm}:${ss}.${msStr}>`;
      case 'enhanced_word':
        return `<${mm}:${ss}.${msStr}>`;
      default:
        return `[${mm}:${ss}.${msStr}]`;
    }
  }

  /**
   * Get element text content recursively
   */
  private _getElementText(element: any): string {
    if (!element) return '';

    let text = '';
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes[i];
      if (child.nodeType === 3) {
        // Text node
        text += child.nodeValue;
      } else if (child.nodeType === 1) {
        // Element node
        text += this._getElementText(child);
      }
    }
    return text;
  }

  /**
   * Find element by XPath-like selector
   */
  private _findElementBySelector(doc: any, selector: string): any {
    // Simple implementation for specific selectors used in the code
    if (selector.includes("[@for='")) {
      const forValue = selector.match(/@for='([^']+)'/)[1];
      const elements = doc.getElementsByTagName('text');
      for (let i = 0; i < elements.length; i++) {
        if (elements[i].getAttribute('for') === forValue) {
          return elements[i];
        }
      }
    }
    return null;
  }

  /**
   * Parse TTML data and convert to LRC format
   */
  private _parseTTMLToLRC(ttmlData: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlData, 'text/xml');
    const lrcLines = [];

    const ttElement = doc.getElementsByTagName('tt')[0];
    if (!ttElement) {
      throw new Error('Invalid TTML format: no <tt> element found');
    }

    // Check timing attribute
    const timingAttr = ttElement.getAttribute('itunes:timing');

    if (timingAttr === 'None') {
      // No timing information, just return text
      const pElements = doc.getElementsByTagName('p');
      for (let i = 0; i < pElements.length; i++) {
        const text = this._getElementText(pElements[i]).trim();
        if (text) {
          lrcLines.push(text);
        }
      }
      return lrcLines.join('\n');
    }

    // Handle line-level timing
    const bodyElement = doc.getElementsByTagName('body')[0];
    if (!bodyElement) {
      throw new Error('Invalid TTML format: no <body> element found');
    }

    const divElements = bodyElement.getElementsByTagName('div');

    for (let divIndex = 0; divIndex < divElements.length; divIndex++) {
      const div = divElements[divIndex];

      for (let itemIndex = 0; itemIndex < div.childNodes.length; itemIndex++) {
        const item = div.childNodes[itemIndex];
        if (item.nodeType !== 1) continue; // Skip non-element nodes

        // @ts-ignore - DOM element casting
        const beginAttr = item.getAttribute('begin');
        if (!beginAttr) {
          throw new Error('No synchronised lyrics: missing begin attribute');
        }

        const timeObj = this._parseTimeToSeconds(beginAttr);

        // Get translations and transliterations
        let text = '',
          transText = '',
          translitText = '';
        // @ts-ignore - DOM element casting
        const itemKey = item.getAttribute('itunes:key');

        if (itemKey) {
          // Look for metadata in head section
          const headElements = doc.getElementsByTagName('head');
          if (headElements.length > 0) {
            const metadataElements = headElements[0].getElementsByTagName('metadata');
            if (metadataElements.length > 0) {
              const iTunesMetadata = metadataElements[0].getElementsByTagName('iTunesMetadata')[0];
              if (iTunesMetadata) {
                // Get transliteration
                const transliterations = iTunesMetadata.getElementsByTagName('transliterations')[0];
                if (transliterations) {
                  const transliteration =
                    transliterations.getElementsByTagName('transliteration')[0];
                  if (transliteration) {
                    const translitElement = this._findElementBySelector(
                      transliteration,
                      `text[@for='${itemKey}']`,
                    );
                    if (translitElement) {
                      translitText =
                        translitElement.getAttribute('text') ||
                        this._getElementText(translitElement);
                    }
                  }
                }

                // Get translation
                const translations = iTunesMetadata.getElementsByTagName('translations')[0];
                if (translations) {
                  const translation = translations.getElementsByTagName('translation')[0];
                  if (translation) {
                    const transElement = this._findElementBySelector(
                      translation,
                      `text[@for='${itemKey}']`,
                    );
                    if (transElement) {
                      transText =
                        transElement.getAttribute('text') || this._getElementText(transElement);
                    }
                  }
                }
              }
            }
          }
        }

        // Get main text
        // @ts-ignore - DOM element casting
        text = item.getAttribute('text') || this._getElementText(item);

        const timeFormat = this._formatLRCTime(timeObj, 'standard');

        // Add translation if available
        if (transText) {
          lrcLines.push(timeFormat + transText);
        }

        // Add transliteration for CJK text, otherwise original text
        if (translitText && this._containsCJK(text)) {
          lrcLines.push(timeFormat + translitText);
        } else {
          lrcLines.push(timeFormat + text);
        }
      }
    }

    return lrcLines.join('\n');
  }

  /**
   * Make HTTP request with retry logic
   */
  private _makeRequest(url: string, retryCount: number = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: this.config.timeout }, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        if (retryCount < this.config.maxRetries) {
          this._debug(`Request failed, retrying... (${retryCount + 1}/${this.config.maxRetries})`);
          setTimeout(
            () => {
              this._makeRequest(url, retryCount + 1)
                .then(resolve)
                .catch(reject);
            },
            1000 * (retryCount + 1),
          );
        } else {
          reject(error);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Search Apple Music for songs
   */
  async searchAppleMusic(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10 } = options;
    const encodedQuery = encodeURIComponent(query);

    // Use iTunes Search API (public, no auth required)
    const searchUrl = `https://itunes.apple.com/search?term=${encodedQuery}&country=${this.config.countryCode}&media=music&entity=song&limit=${limit}`;

    this._debug(`Searching Apple Music: ${searchUrl}`);

    try {
      const response = await this._makeRequest(searchUrl);
      const data = JSON.parse(response as string);

      if (!data.results || data.results.length === 0) {
        return [];
      }

      return data.results.map((result) => ({
        trackId: result.trackId,
        trackName: result.trackName,
        artistName: result.artistName,
        albumName: result.collectionName,
        duration: result.trackTimeMillis,
        previewUrl: result.previewUrl,
        artworkUrl: result.artworkUrl100?.replace('100x100', '600x600'),
        releaseDate: result.releaseDate,
        isLyricsAvailable: result.hasLyrics || false,
      }));
    } catch (error) {
      this._debug(`Search error: ${error.message}`);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Fetch lyrics with authentication (Apple Music API)
   */
  async fetchLyricsWithAuth(
    songId: string | number,
    storefront: string = 'IN',
    lrcType: string = 'lyrics', // 'syllable-lyrics' for syllable-based lyrics
    token: string,
    mediaUserToken: string,
    options: FetchOptions = {},
  ): Promise<string> {
    const { language = this.config.languageCode, format = 'lrc' } = options;

    if (!mediaUserToken || mediaUserToken.length < 50) {
      throw new Error('MediaUserToken not set or invalid');
    }

    const url = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}/${lrcType}?l=${language}&extend=ttmlLocalizations`;

    this._debug(`Fetching authenticated lyrics from: ${url}`);

    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          Origin: 'https://music.apple.com',
          Referer: 'https://music.apple.com/',
          Authorization: `Bearer ${token}`,
          Cookie: `media-user-token=${mediaUserToken}`,
        },
        timeout: this.config.timeout,
      };

      const req = https.get(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
              return;
            }

            const jsonData = JSON.parse(data);

            if (!jsonData.data || jsonData.data.length === 0) {
              reject(new Error('Failed to get lyrics: no data in response'));
              return;
            }

            const ttmlData =
              jsonData.data[0].attributes.ttml || jsonData.data[0].attributes.ttmlLocalizations;

            if (!ttmlData) {
              reject(new Error('Failed to get lyrics: no TTML data found'));
              return;
            }

            if (format === 'ttml') {
              resolve(ttmlData);
            } else {
              const lrcContent = this._parseTTMLToLRC(ttmlData);
              resolve(lrcContent);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }
}

export default AppleMusicLyricsLRC;
export { AppleMusicLyricsLRC };
export type {
  AppleMusicConfig,
  AppleMusicOptions,
  FetchOptions,
  SearchOptions,
  SearchResult,
  TimeObject,
};
