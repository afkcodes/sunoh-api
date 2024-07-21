// Utility function to check if a value is an object and not null
export function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}

// Utility function to check if an object is empty
export function isEmptyObject(obj: unknown): boolean {
  if (!isObject(obj)) {
    return false;
  }
  return Object.keys(obj).length === 0;
}

// Utility function to check if a value is a function
export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

// Utility function to check if a value is an array
export function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

// Utility function to check if an array is empty
export function isEmptyArray<T>(arr: unknown): boolean {
  if (!isArray(arr)) {
    return false;
  }
  return arr.length === 0;
}

// Utility function to check if a value is the global window object
export function isWindow(value: unknown): value is Window {
  return value != null && (value as Window) === (value as Window).window;
}

// Utility function to check if a value is a string
export function isString(value: unknown): value is string {
  return typeof value === 'string' || value instanceof String;
}

// Utility function to check if a string is empty
export function isEmptyString(str: unknown): boolean {
  if (!isString(str)) {
    return false;
  }
  return str.trim().length === 0;
}

// Utility function to check if a value is a number
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

// Utility function to check if a value is a boolean
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

// Utility function to check if a value is null
export function isNull(value: unknown): value is null {
  return value === null;
}

// Utility function to check if a value is undefined
export function isUndefined(value: unknown): value is undefined {
  return typeof value === 'undefined';
}

// Utility function to check if a value is a Date object
export function isDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

// Utility function to check if a value is a RegExp object
export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

// Utility function to check if a value is a DOM element
export function isElement(value: unknown): value is Element {
  return value instanceof Element;
}

// Utility function to check if a value is a promise
export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return (
    value instanceof Promise || (value != null && typeof (value as Promise<T>).then === 'function')
  );
}

// Utility function to check if a value is iterable (e.g., array, string, Map, Set)
export function isIterable<T = unknown>(value: unknown): value is Iterable<T> {
  return value != null && typeof (value as Iterable<T>)[Symbol.iterator] === 'function';
}

// Utility function to check if a Map is empty
export function isEmptyMap<K, V>(map: unknown): boolean {
  if (!(map instanceof Map)) {
    return false;
  }
  return map.size === 0;
}

// Utility function to check if a Set is empty
export function isEmptySet<T>(set: unknown): boolean {
  if (!(set instanceof Set)) {
    return false;
  }
  return set.size === 0;
}

// Utility function to check if a value is an empty iterable
export function isEmptyIterable<T = unknown>(iterable: unknown): boolean {
  if (!isIterable(iterable)) {
    return false;
  }
  return [...iterable].length === 0;
}
