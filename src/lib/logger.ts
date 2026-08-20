/**
 * Structured server-side logging.
 *
 * Two rules, enforced by `redact()`:
 *   1. Never log a Plaid access token, encryption key, Anthropic key, or
 *      Supabase secret — not even truncated.
 *   2. Never log raw financial payloads (balances, transaction lists). Log
 *      counts and identifiers instead.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN =
  /(access_token|accessToken|token|secret|api_?key|apiKey|password|authorization|encrypted|public_token|link_token)/i;

const isDev = process.env.NODE_ENV !== "production";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Catch a token that was passed as a bare string in a message field.
    return value.replace(/access-(sandbox|development|production)-[\w-]+/g, "[redacted-token]");
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redact(val, depth + 1);
  }
  return out;
}

function emit(level: LogLevel, event: string, context?: Record<string, unknown>) {
  if (level === "debug" && !isDev) return;
  const entry = {
    level,
    event,
    at: new Date().toISOString(),
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => emit("debug", event, context),
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};

/**
 * Turns any thrown value into a message that is safe to show a normal user.
 * The technical detail goes to the server log; the user gets plain English.
 */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && (error as { userFacing?: boolean }).userFacing) {
    return error.message;
  }
  return fallback;
}

/** An error whose message is already written for a human. */
export class UserFacingError extends Error {
  userFacing = true;
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserFacingError";
    this.status = status;
  }
}
