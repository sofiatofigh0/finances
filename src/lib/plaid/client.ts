import "server-only";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type CountryCode,
  type Products,
} from "plaid";
import { serverEnv } from "@/lib/env";
import { UserFacingError } from "@/lib/logger";

/**
 * Plaid client.
 *
 * The environment is configuration, not code: flipping PLAID_ENV from
 * `sandbox` to `production` is the only change needed to connect real
 * institutions. Nothing in this file is environment-specific.
 */

export class PlaidNotConfiguredError extends UserFacingError {
  constructor() {
    super(
      "Plaid isn't connected yet. Add PLAID_CLIENT_ID and PLAID_SECRET to your environment to link accounts.",
      503,
    );
    this.name = "PlaidNotConfiguredError";
  }
}

let cached: PlaidApi | null = null;

export function isPlaidConfigured(): boolean {
  return Boolean(serverEnv.plaidClientId && serverEnv.plaidSecret);
}

export function getPlaidClient(): PlaidApi {
  if (!isPlaidConfigured()) throw new PlaidNotConfiguredError();
  if (cached) return cached;

  const env = serverEnv.plaidEnv.toLowerCase();
  const basePath =
    PlaidEnvironments[env as keyof typeof PlaidEnvironments] ??
    PlaidEnvironments.sandbox;

  cached = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": serverEnv.plaidClientId as string,
          "PLAID-SECRET": serverEnv.plaidSecret as string,
        },
      },
    }),
  );
  return cached;
}

/**
 * Products requested at Link time.
 *
 * `liabilities` is requested as an OPTIONAL product so an institution that
 * does not support it still links successfully — the app falls back to manual
 * liabilities in that case rather than failing the connection.
 */
export const PLAID_PRODUCTS: Products[] = ["transactions"] as Products[];
export const PLAID_OPTIONAL_PRODUCTS: Products[] = ["liabilities"] as Products[];
export const PLAID_COUNTRY_CODES: CountryCode[] = ["US"] as CountryCode[];

/** How much history to request on first link. */
export const INITIAL_HISTORY_DAYS = 180;

/**
 * Turns a Plaid error into something a normal person can read, while the
 * technical detail stays in the server log.
 */
export interface PlaidErrorShape {
  errorCode: string | null;
  errorType: string | null;
  userMessage: string;
  requiresReauth: boolean;
}

export function interpretPlaidError(error: unknown): PlaidErrorShape {
  const response = (
    error as { response?: { data?: Record<string, unknown> } }
  )?.response?.data;

  const errorCode = (response?.error_code as string) ?? null;
  const errorType = (response?.error_type as string) ?? null;

  const requiresReauth =
    errorCode === "ITEM_LOGIN_REQUIRED" ||
    errorCode === "ITEM_ERROR" ||
    errorCode === "PENDING_EXPIRATION" ||
    errorCode === "ACCESS_NOT_GRANTED";

  let userMessage: string;
  switch (errorCode) {
    case "ITEM_LOGIN_REQUIRED":
      userMessage =
        "This institution needs you to sign in again. Your previous data is still available.";
      break;
    case "PENDING_EXPIRATION":
      userMessage =
        "Your connection to this institution is about to expire. Reconnect to keep it up to date.";
      break;
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
      userMessage =
        "This institution isn't responding right now. We'll try again shortly — your previous data is still available.";
      break;
    case "RATE_LIMIT_EXCEEDED":
      userMessage =
        "We're refreshing too often right now. Please try again in a few minutes.";
      break;
    case "PRODUCTS_NOT_SUPPORTED":
    case "PRODUCT_NOT_READY":
      userMessage =
        "This institution doesn't share that data yet. You can add the details manually in the meantime.";
      break;
    case "NO_ACCOUNTS":
      userMessage = "No supported accounts were found at this institution.";
      break;
    default:
      userMessage =
        "We couldn't refresh this account. Your previous data is still available.";
  }

  return { errorCode, errorType, userMessage, requiresReauth };
}
