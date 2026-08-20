import "server-only";
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type JsonWebKey,
} from "node:crypto";
import { getPlaidClient } from "./client";
import { logger } from "@/lib/logger";

/**
 * Plaid webhook verification, implemented per Plaid's official flow rather
 * than an invented scheme:
 *
 *   1. Read the JWT from the `Plaid-Verification` header.
 *   2. Take `kid` from the JWT header and fetch the matching public JWK from
 *      /webhook_verification_key/get.
 *   3. Verify the ES256 signature against that key.
 *   4. Confirm the JWT is recent (replay protection).
 *   5. Confirm SHA-256 of the raw request body equals the
 *      `request_body_sha256` claim, so the payload cannot be swapped.
 *
 * Verification failure means the request is rejected — we never fall back to
 * trusting an unverified body.
 */

const MAX_AGE_SECONDS = 5 * 60;

// The key set rotates rarely; caching avoids a Plaid call per webhook.
const keyCache = new Map<string, { jwk: JsonWebKey; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

interface JwtHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JwtClaims {
  iat: number;
  request_body_sha256: string;
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

async function fetchVerificationKey(kid: string): Promise<JsonWebKey | null> {
  const cached = keyCache.get(kid);
  if (cached && Date.now() - cached.fetchedAt < KEY_TTL_MS) return cached.jwk;

  try {
    const client = getPlaidClient();
    const response = await client.webhookVerificationKeyGet({ key_id: kid });
    const key = response.data.key as unknown as JsonWebKey;
    keyCache.set(kid, { jwk: key, fetchedAt: Date.now() });
    return key;
  } catch (error) {
    logger.error("plaid.webhook.key_fetch_failed", {
      kid,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export interface VerificationResult {
  verified: boolean;
  reason?: string;
}

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
): Promise<VerificationResult> {
  if (!verificationHeader) {
    return { verified: false, reason: "missing_verification_header" };
  }

  const parts = verificationHeader.split(".");
  if (parts.length !== 3) {
    return { verified: false, reason: "malformed_jwt" };
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
    claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  } catch {
    return { verified: false, reason: "unparseable_jwt" };
  }

  // Plaid signs webhooks with ES256. Anything else — including "none" — is a
  // downgrade attempt.
  if (header.alg !== "ES256") {
    return { verified: false, reason: "unexpected_algorithm" };
  }
  if (!header.kid) {
    return { verified: false, reason: "missing_kid" };
  }

  const jwk = await fetchVerificationKey(header.kid);
  if (!jwk) return { verified: false, reason: "unknown_key" };

  let signatureValid = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    signatureValid = cryptoVerify(
      "sha256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      // ES256 JWT signatures are raw r||s, not DER.
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      base64UrlDecode(signaturePart),
    );
  } catch (error) {
    logger.error("plaid.webhook.signature_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { verified: false, reason: "signature_error" };
  }

  if (!signatureValid) return { verified: false, reason: "bad_signature" };

  const ageSeconds = Math.floor(Date.now() / 1000) - claims.iat;
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_AGE_SECONDS) {
    return { verified: false, reason: "stale_webhook" };
  }

  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (bodyHash !== claims.request_body_sha256) {
    return { verified: false, reason: "body_hash_mismatch" };
  }

  return { verified: true };
}
