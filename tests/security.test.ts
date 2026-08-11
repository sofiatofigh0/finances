import { describe, expect, it, beforeAll, vi } from "vitest";
import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

/**
 * Security-critical paths: token encryption at rest, and Plaid webhook
 * verification. These are the two places where getting it wrong is not a bug
 * but an incident, so they are tested against real cryptography rather than
 * mocked.
 */

// A 32-byte key, as `openssl rand -base64 32` would produce.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.FINANCIAL_TOKEN_ENCRYPTION_KEY = TEST_KEY;

const { encryptToken, decryptToken, safeEqual } = await import(
  "@/lib/security/crypto"
);

describe("Plaid access token encryption", () => {
  it("round-trips a token", () => {
    const token = "access-sandbox-2f8c1b4e-0a11-4c9e-9f3a-5d6e7f8a9b0c";
    const encrypted = encryptToken(token);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it("never stores the plaintext token in the ciphertext", () => {
    const token = "access-sandbox-secret-value-here";
    const encrypted = encryptToken(token);
    expect(encrypted).not.toContain("access-sandbox");
    expect(encrypted).not.toContain("secret-value");
  });

  it("produces a different ciphertext each time (random nonce)", () => {
    const token = "access-sandbox-same-token";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("is versioned so the algorithm can be rotated later", () => {
    expect(encryptToken("x").startsWith("v1.")).toBe(true);
  });

  it("rejects tampered ciphertext instead of returning garbage", () => {
    const encrypted = encryptToken("access-sandbox-token");
    const parts = encrypted.split(".");
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3], "base64url");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64url");

    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("rejects a swapped auth tag", () => {
    const a = encryptToken("token-a");
    const b = encryptToken("token-b");
    const partsA = a.split(".");
    const partsB = b.split(".");
    partsA[2] = partsB[2];
    expect(() => decryptToken(partsA.join("."))).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptToken("not-a-real-payload")).toThrow(
      /not in the expected format/,
    );
  });

  it("refuses to encrypt an empty token", () => {
    expect(() => encryptToken("")).toThrow();
  });
});

describe("constant-time secret comparison", () => {
  it("matches identical secrets", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });
  it("rejects different secrets", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });
  it("rejects different lengths without throwing", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plaid webhook verification
// ---------------------------------------------------------------------------

let privateKey: KeyObject;
let publicJwk: JsonWebKey;

// Stand in for Plaid's /webhook_verification_key/get.
vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: () => ({
    webhookVerificationKeyGet: async () => ({ data: { key: publicJwk } }),
  }),
  interpretPlaidError: () => ({
    errorCode: null,
    errorType: null,
    userMessage: "",
    requiresReauth: false,
  }),
}));

const { verifyPlaidWebhook } = await import("@/lib/plaid/webhook");

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Builds a genuine ES256 JWT the way Plaid signs webhooks. */
function signJwt(
  claims: Record<string, unknown>,
  options: { alg?: string; kid?: string } = {},
): string {
  const header = { alg: options.alg ?? "ES256", kid: options.kid ?? "test-key", typ: "JWT" };
  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(claims));

  const signer = createSign("SHA256");
  signer.update(`${headerPart}.${payloadPart}`);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return `${headerPart}.${payloadPart}.${b64url(signature)}`;
}

beforeAll(() => {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  privateKey = pair.privateKey;
  publicJwk = pair.publicKey.export({ format: "jwk" }) as JsonWebKey;
});

describe("Plaid webhook verification", () => {
  const body = JSON.stringify({
    webhook_type: "TRANSACTIONS",
    webhook_code: "SYNC_UPDATES_AVAILABLE",
    item_id: "item-123",
  });

  function validClaims(overrides: Record<string, unknown> = {}) {
    return {
      iat: Math.floor(Date.now() / 1000),
      request_body_sha256: createHash("sha256").update(body, "utf8").digest("hex"),
      ...overrides,
    };
  }

  it("accepts a correctly signed, fresh webhook", async () => {
    const result = await verifyPlaidWebhook(body, signJwt(validClaims()));
    expect(result.verified).toBe(true);
  });

  it("rejects a missing verification header", async () => {
    const result = await verifyPlaidWebhook(body, null);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("missing_verification_header");
  });

  it("rejects a malformed JWT", async () => {
    const result = await verifyPlaidWebhook(body, "nope");
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("malformed_jwt");
  });

  it("rejects an algorithm downgrade to none", async () => {
    const header = b64url(JSON.stringify({ alg: "none", kid: "test-key" }));
    const payload = b64url(JSON.stringify(validClaims()));
    const result = await verifyPlaidWebhook(body, `${header}.${payload}.`);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("unexpected_algorithm");
  });

  it("rejects a JWT with no key id", async () => {
    const header = b64url(JSON.stringify({ alg: "ES256" }));
    const payload = b64url(JSON.stringify(validClaims()));
    const result = await verifyPlaidWebhook(body, `${header}.${payload}.AAAA`);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("missing_kid");
  });

  it("rejects a forged signature", async () => {
    const token = signJwt(validClaims());
    const parts = token.split(".");
    const sig = Buffer.from(parts[2], "base64url");
    sig[0] ^= 0xff;
    parts[2] = sig.toString("base64url");

    const result = await verifyPlaidWebhook(body, parts.join("."));
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects a replayed (stale) webhook", async () => {
    const stale = signJwt(
      validClaims({ iat: Math.floor(Date.now() / 1000) - 3600 }),
    );
    const result = await verifyPlaidWebhook(body, stale);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("stale_webhook");
  });

  it("rejects a swapped body even with a valid signature", async () => {
    // Signature is valid for the original body, but the body was replaced.
    const token = signJwt(validClaims());
    const tamperedBody = JSON.stringify({
      webhook_type: "ITEM",
      webhook_code: "USER_PERMISSION_REVOKED",
      item_id: "item-999",
    });

    const result = await verifyPlaidWebhook(tamperedBody, token);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("body_hash_mismatch");
  });
});
