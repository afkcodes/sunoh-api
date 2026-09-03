/** Minimal levelled logger. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
export type LogLevel = keyof typeof LEVELS;

function threshold(): number {
  const configured = (process.env["LOG_LEVEL"] ?? "info").toLowerCase() as LogLevel;
  return LEVELS[configured] ?? LEVELS.info;
}

let min = threshold();

export function setLevel(level: LogLevel): void {
  min = LEVELS[level] ?? LEVELS.info;
}

function emit(level: LogLevel, scope: string | undefined, args: unknown[]): void {
  if (LEVELS[level] < min) return;
  const stamp = new Date().toISOString();
  const prefix = scope ? `${stamp} ${level.toUpperCase()} [${scope}]` : `${stamp} ${level.toUpperCase()}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(prefix, ...args);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

function make(scope?: string): Logger {
  return {
    debug: (...a) => emit("debug", scope, a),
    info: (...a) => emit("info", scope, a),
    warn: (...a) => emit("warn", scope, a),
    error: (...a) => emit("error", scope, a),
    child: (childScope: string) => make(scope ? `${scope}.${childScope}` : childScope),
  };
}

export const logger = make();
