import CryptoJS from 'crypto-js';

const GAANA_KEY = CryptoJS.lib.WordArray.create(
  [1735995764, 593641578, 1814585892, 2004118885],
  16,
);

export const decryptGaanaUrl = (message: string): string => {
  if (!message || typeof message !== 'string') return '';

  try {
    const offset = parseInt(message[0], 10);
    const BLOCK_SIZE = 16;

    // Extract raw IV
    const ivRaw = message.slice(offset, offset + BLOCK_SIZE);
    const iv = CryptoJS.enc.Utf8.parse(ivRaw);

    // Ciphertext
    const cipherText = message.slice(offset + BLOCK_SIZE);

    const decrypted = CryptoJS.AES.decrypt(cipherText, GAANA_KEY, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Gaana decryption failed:', error);
    return '';
  }
};
