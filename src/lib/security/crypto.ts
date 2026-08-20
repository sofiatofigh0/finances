import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * AES-256-GCM encryption for Plaid access tokens at rest.
 *
 * Tokens are encrypted before they are written to Supabase and decrypted only
 * inside server-side code paths that immediately hand them to the Plaid SDK.
 * A plaintext access token is never returned to a client component, never
 * written to a log, and never included in an error message.
 *
 * Ciphertext format (all base64url, dot-separated):
 *   v1.<iv>.<authTag>.<ciphertext>
 *
 * The version prefix lets us rotate the algorithm later without ambiguity.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32;

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      "FINANCIAL_TOKEN_ENCRYPTION_KEY is not set. Generate one with: " +
        "openssl rand -base64 32",
    );
    this.name = "EncryptionNotConfiguredError";
  }
}

function loadKey(): Buffer {
  const raw = serverEnv.tokenEncryptionKey;
  if (!raw) throw new EncryptionNotConfiguredError();

  // Accept base64, base64url, or 64-char hex so the operator can paste output
  // from either `openssl rand -base64 32` or `openssl rand -hex 32`.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `FINANCIAL_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes ` +
        `(got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error("Refusing to encrypt an empty token.");
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptToken(payload: string): string {
  const key = loadKey();
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Stored credential is not in the expected format.");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(dataPart, "base64url");

  if (iv.length !== IV_BYTES) {
    throw new Error("Stored credential has an invalid nonce.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // `final()` throws if the auth tag does not verify, which is exactly the
  // tamper-detection we want.
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time comparison for shared secrets (scheduled sync auth). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
