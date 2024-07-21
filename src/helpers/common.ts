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
