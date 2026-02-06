import Crypto from 'crypto-js';
import { Quality } from './type';

/**
 * Transforms any string case (e.g., snake_case, kebab-case, PascalCase) to camelCase.
 * @param str - The input string to be transformed.
 * @returns The camelCase version of the input string.
 */
export function toCamelCase(str: string): string {
  return (
    str
      // Replace all non-alphanumeric characters and underscores with a space
      .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase())
      // Ensure the first character is lower case
      .replace(/^./, (match) => match.toLowerCase())
  );
}

/**
 * Transforms any string case (e.g., snake_case, kebab-case, PascalCase, camelCase) to a sentence with each word capitalized.
 * @param str - The input string to be transformed.
 * @returns The sentence-cased version of the input string.
 */
export function toSentenceCase(str: string): string {
  // Replace non-alphanumeric characters and underscores with spaces, then split by spaces
  const words = str
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase words
    .replace(/[^a-zA-Z0-9]+/g, ' ') // Replace non-alphanumeric characters with spaces
    .toLowerCase() // Convert to lowercase
    .trim() // Trim extra spaces
    .split(' '); // Split into words by spaces

  // Capitalize the first character of each word
  const capitalizedWords = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  // Join words into a single string
  return capitalizedWords.join(' ');
}

export function extractToken(url: string): string | null {
  // This regex matches one or more characters that are not a forward slash,
  // followed by the end of the string
  const regex = /([^\/]+)$/;

  const match = url.match(regex);

  // If there's a match, return the captured group, otherwise return null
  return match ? match[1] : null;
}

export function createDownloadLinks(encryptedMediaUrl: string): Quality {
  const qualities = [
    { id: '_12', bitrate: '12kbps' },
    { id: '_48', bitrate: '48kbps' },
    { id: '_96', bitrate: '96kbps' },
    { id: '_160', bitrate: '160kbps' },
    { id: '_320', bitrate: '320kbps' },
  ];

  const key = '38346591';

  const decrypted = Crypto.DES.decrypt(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    { ciphertext: Crypto.enc.Base64.parse(encryptedMediaUrl) },
    Crypto.enc.Utf8.parse(key),
    { mode: Crypto.mode.ECB },
  );

  const decryptedLink = decrypted.toString(Crypto.enc.Utf8);

  for (const q of qualities) {
    if (decryptedLink.includes(q.id)) {
      return qualities.map(({ id, bitrate }) => ({
        quality: bitrate,
        link: decryptedLink.replace(q.id, id),
      }));
    }
  }

  return decryptedLink;
}

export function getToken(url: string) {
  const regex = /\/([^\/]+)\/?$/;
  const match = url.match(regex);
  return match ? match[1] : '';
}

export const isValidFunction = (fun: any) => typeof fun === 'function';
export const isValidArray = (arr: any[]) => arr && Array.isArray(arr) && arr.length > 0;
export const isValidObject = (obj: any): boolean =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

export function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export const promiseAllLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: Promise<R>[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item);
    results.push(p);

    if (limit <= items.length) {
      const e = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
};

export const isValidTitle = (title: string): boolean => {
  if (!title || typeof title !== 'string') return false;
  const trimmed = title.trim();
  if (trimmed.length === 0) return false;

  const genericWords = ['title', 'untitled', 'unknown', 'null', 'undefined', 'placeholder', 'none'];
  const lowerTitle = trimmed.toLowerCase();

  // If the title contains any of the generic words as the sole word or in a way that suggests it's a placeholder
  if (genericWords.some((word) => lowerTitle === word || lowerTitle === `${word}s`)) return false;

  // Substring check for very common generic ones
  if (
    lowerTitle.includes('untitled') ||
    lowerTitle.includes('placeholder') ||
    lowerTitle === 'title' ||
    lowerTitle.startsWith('title ') ||
    lowerTitle.endsWith(' title') ||
    lowerTitle.includes(' title ')
  )
    return false;

  // If it's just a numeric ID
  if (/^\d+$/.test(trimmed)) return false;

  return true;
};
