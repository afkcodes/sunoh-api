/**
 * Represents a nested object structure where values can be of any type.
 */
type NestedObject = Record<string, unknown>;

/**
 * Safely extracts a value from a nested object structure using a key path.
 *
 * @template T The expected type of the extracted value.
 * @param {NestedObject} obj - The object to extract the value from.
 * @param {string} key - The key path to the desired value, using dot notation or a custom delimiter.
 * @param {string} [delimiter='.'] - The delimiter used in the key path. Defaults to '.'.
 * @returns {T | null} The extracted value of type T, or null if the path is invalid or the value doesn't exist.
 *
 * @example
 * const user = { name: 'John', address: { city: 'New York' } };
 * const city = dataExtractor<string>(user, 'address.city'); // Returns 'New York'
 *
 * @example
 * const data = { 'level1/level2': { 'level3/level4': 42 } };
 * const value = dataExtractor<number>(data, 'level1/level2/level3/level4', '/'); // Returns 42
 */
export function dataExtractor<T>(
  obj: NestedObject,
  key: string,
  delimiter: string = '.',
): T | null {
  // Check if the input object is null, undefined, or not an object
  if (obj == null || typeof obj !== 'object') {
    return null;
  }

  // Split the key into an array of nested keys
  const keys = key.split(delimiter);
  let currentValue: unknown = obj;

  // Traverse the object using the keys
  for (const k of keys) {
    // If we've reached a null or undefined value, we can't go further
    if (currentValue == null) {
      return null;
    }

    if (Array.isArray(currentValue)) {
      // If the current value is an array, try to access it by index
      const index = parseInt(k, 10);
      if (Number.isInteger(index) && index >= 0 && index < currentValue.length) {
        currentValue = currentValue[index];
      } else {
        // Invalid array index
        return null;
      }
    } else if (typeof currentValue === 'object') {
      // If it's an object, access the property
      currentValue = (currentValue as NestedObject)[k];
    } else {
      // If it's neither an array nor an object, we can't continue
      return null;
    }
  }

  // Cast the final value to the expected type T or null
  return currentValue as T | null;
}

// Usage examples

// Example 1: Basic object with type safety
// const user = {
//   name: 'John Doe',
//   age: 30,
//   address: {
//     street: '123 Main St',
//     city: 'Anytown',
//   },
// };

// const userName = dataExtractor<string>(user, 'name');
// console.log(userName); // Output: John Doe

// const userCity = dataExtractor<string>(user, 'address.city');
// console.log(userCity); // Output: Anytown

// const userCountry = dataExtractor<string>(user, 'address.country');
// console.log(userCountry); // Output: null

// Example 2: Array handling with type safety
// const data = {
//   users: [
//     { id: 1, name: 'Alice' },
//     { id: 2, name: 'Bob' },
//   ],
//   settings: {
//     theme: 'dark',
//     notifications: {
//       email: true,
//       sms: false,
//     },
//   },
// };

// const secondUserName = dataExtractor<string>(data, 'users.1.name');
// console.log(secondUserName); // Output: Bob

// const emailNotification = dataExtractor<boolean>(data, 'settings.notifications.email');
// console.log(emailNotification); // Output: true

// Example 3: Using custom delimiter
// const customDelimiterData = {
//   'level1/level2': {
//     'level3/level4': 'Deep nested value',
//   },
// };

// const deepValue = dataExtractor<string>(
//   customDelimiterData,
//   'level1/level2/level3/level4',
//   '/'
// );
// console.log(deepValue); // Output: Deep nested value

// Example 4: Mixed nested structure with type safety
// const complexData = {
//   level1: {
//     level2: [
//       {
//         level3: {
//           level4: 42,
//         },
//       },
//     ],
//   },
// };

// const deepNumber = dataExtractor<number>(complexData, 'level1.level2.0.level3.level4');
// console.log(deepNumber); // Output: 42

// Example 5: Incorrect type specification (TypeScript will warn about this)
// const incorrectType = dataExtractor<string>(complexData, 'level1.level2.0.level3.level4');
// console.log(incorrectType); // Output: 42 (but TypeScript will warn that this might not be a string)
