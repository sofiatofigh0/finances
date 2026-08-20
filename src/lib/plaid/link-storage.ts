"use client";

/**
 * Survives the OAuth round trip.
 *
 * Large institutions hand Link off to the bank's own site, which returns the
 * browser to a registered redirect URI — a fresh page load with none of the
 * original React state. Link can only resume with the same token it started
 * with, so the token is parked in localStorage before the handoff and read
 * back on return.
 *
 * The link token is short-lived, single-purpose, and useless without the
 * session that requested it; it is not the access token, which never reaches
 * the browser at all.
 */

const TOKEN_KEY = "spendable.plaid.link_token";
const RETURN_KEY = "spendable.plaid.return_to";

export function rememberLinkSession(token: string, returnTo: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(RETURN_KEY, returnTo);
  } catch {
    // Private browsing can refuse storage. OAuth institutions will not work in
    // that case, but everything else still does, so this must not throw.
  }
}

export function readLinkSession(): { token: string | null; returnTo: string } {
  try {
    return {
      token: window.localStorage.getItem(TOKEN_KEY),
      returnTo: window.localStorage.getItem(RETURN_KEY) || "/accounts",
    };
  } catch {
    return { token: null, returnTo: "/accounts" };
  }
}

export function clearLinkSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(RETURN_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Sends the public token to the server, which does the privileged half. */
export async function exchangePublicToken(input: {
  publicToken: string;
  institutionId: string | null;
  institutionName: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/plaid/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: data.code
          ? `${data.error ?? "We couldn't finish connecting."} (${data.code})`
          : (data.error ?? "We couldn't finish connecting."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't reach the server. Please try again." };
  }
}
