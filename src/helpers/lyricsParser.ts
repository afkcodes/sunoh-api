/**
 * Parses lyrics in LRC format and converts them to LyricLine array
 * Expected format: [mm:ss.ms]Lyric text
 * Example: [00:28.84]Sample lyric line
 */

interface ParsedLyric {
  timestamp: number;
  text: string;
  isChorus?: boolean;
}

/**
 * Converts timestamp string to seconds
 * @param timestamp - Format: "mm:ss.ms" or "mm:ss"
 * @returns Time in seconds
 */
const parseTimestamp = (timestamp: string): number => {
  const parts = timestamp.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid timestamp format: ${timestamp}`);
  }

  const minutes = parseInt(parts[0], 10);
  const secondsParts = parts[1].split('.');
  if (!secondsParts[0]) {
    throw new Error(`Invalid seconds format: ${timestamp}`);
  }

  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = secondsParts[1] ? parseInt(secondsParts[1].padEnd(3, '0'), 10) : 0;

  return minutes * 60 + seconds + milliseconds / 1000;
};

/**
 * Detects if a lyric line is likely a chorus based on common patterns
 * @param text - The lyric text
 * @param allLyrics - All parsed lyrics for pattern matching
 * @returns Whether the line is likely a chorus
 */
const detectChorus = (text: string, allLyrics: ParsedLyric[]): boolean => {
  // Remove parentheses and normalize text for comparison
  const normalizedText = text.toLowerCase().replace(/[()]/g, '').trim();

  // Count how many times this line appears
  const occurrences = allLyrics.filter((lyric) => {
    const normalizedLyric = lyric.text.toLowerCase().replace(/[()]/g, '').trim();
    return normalizedLyric === normalizedText;
  }).length;

  // If it appears more than once, it's likely a chorus
  return occurrences > 1;
};

/**
 * Parses LRC format lyrics string into LyricLine array
 * @param lyricsText - Raw lyrics text in LRC format
 * @param options - Parsing options
 * @returns Array of LyricLine objects
 */
export const parseLyrics = (
  lyricsText: string,
  options: {
    autoDetectChorus?: boolean;
    defaultGap?: number; // Default gap between lines in seconds
  } = {},
) => {
  const { autoDetectChorus = true, defaultGap = 4 } = options;

  // Split into lines and filter out empty lines
  const lines = lyricsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Parse each line
  const parsedLyrics: ParsedLyric[] = [];

  for (const line of lines) {
    // Match pattern [mm:ss.ms]Text or [mm:ss]Text
    const match = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\](.+)$/);

    if (match && match[1] && match[2]) {
      const timestamp = match[1];
      const text = match[2];
      try {
        const timeInSeconds = parseTimestamp(timestamp);
        parsedLyrics.push({
          timestamp: timeInSeconds,
          text: text.trim(),
        });
      } catch (error) {
        console.warn(`Failed to parse timestamp: ${timestamp}`, error);
      }
    }
  }

  // Sort by timestamp
  parsedLyrics.sort((a, b) => a.timestamp - b.timestamp);

  // Detect chorus lines if enabled
  if (autoDetectChorus) {
    parsedLyrics.forEach((lyric) => {
      lyric.isChorus = detectChorus(lyric.text, parsedLyrics);
    });
  }

  // Convert to LyricLine format with calculated end times
  const lyricLines = parsedLyrics.map((lyric, index) => {
    const nextLyric = parsedLyrics[index + 1];
    const endTime = nextLyric ? nextLyric.timestamp : lyric.timestamp + defaultGap;

    return {
      id: `lyric-${index + 1}`,
      startTime: lyric.timestamp,
      endTime: endTime,
      text: lyric.text,
      ...(lyric.isChorus && { isChorus: lyric.isChorus }),
    };
  });

  return lyricLines;
};

/**
 * Parses lyrics from an array of lines (alternative format)
 * @param lyricsLines - Array of lyric lines in LRC format
 * @param options - Parsing options
 * @returns Array of LyricLine objects
 */
export const parseLyricsFromArray = (
  lyricsLines: string[],
  options?: Parameters<typeof parseLyrics>[1],
) => {
  const lyricsText = lyricsLines.join('\n');
  return parseLyrics(lyricsText, options);
};

/**
 * Validates if a string is in valid LRC format
 * @param lyricsText - Text to validate
 * @returns Validation result with any errors
 */
export const validateLyricsFormat = (
  lyricsText: string,
): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = lyricsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    errors.push('No lyrics content found');
    return { isValid: false, errors, warnings };
  }

  let validLyricCount = 0;
  let lastTimestamp = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const match = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\](.+)$/);

    if (!match?.[1] || !match?.[2]) {
      warnings.push(`Line ${i + 1}: Invalid format - "${line}"`);
      continue;
    }

    const timestamp = match[1];
    const text = match[2];

    if (!text.trim()) {
      warnings.push(`Line ${i + 1}: Empty lyric text`);
    }

    try {
      const timeInSeconds = parseTimestamp(timestamp);

      if (timeInSeconds < lastTimestamp) {
        warnings.push(`Line ${i + 1}: Timestamp out of order - ${timestamp}`);
      }

      lastTimestamp = timeInSeconds;
      validLyricCount++;
    } catch {
      errors.push(`Line ${i + 1}: Invalid timestamp format - ${timestamp}`);
    }
  }

  if (validLyricCount === 0) {
    errors.push('No valid lyric lines found');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};
