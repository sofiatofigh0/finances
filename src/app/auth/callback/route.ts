import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

/**
 * Sign-in callback.
 *
 * Supabase hands the session back in one of three shapes and which one you get
 * depends on the flow, so all three are handled here:
 *
 *   ?code=…                  OAuth / PKCE — exchange it for a session.
 *   ?token_hash=…&type=…     Email links — what a magic link actually sends.
 *   #access_token=…          Implicit flow — lives in the fragment, which never
 *                            reaches the server, so it is finished in the
 *                            browser at /auth/finish.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/";

  // Only ever redirect to a path on our own origin.
  const safeNext = next.startsWith("/") ? next : "/";

  // Carry the real reason to the error page. Supabase reports a rejected token
  // here (expired, already used, redirect not allowed), and silently collapsing
  // every one of those into "that link didn't work" leaves nothing to act on.
  const errorPage = (reason: string, detail?: string | null) => {
    const url = new URL("/auth/auth-code-error", origin);
    url.searchParams.set("reason", reason);
    if (detail) url.searchParams.set("detail", detail.slice(0, 300));
    return NextResponse.redirect(url);
  };

  const providerError =
    searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) {
    logger.warn("auth.callback.provider_error", { code: providerError });
    return errorPage(providerError, searchParams.get("error_description"));
  }

  const supabase = await createServerSupabase();

  if (tokenHash && type && (OTP_TYPES as readonly string[]).includes(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) {
      logger.warn("auth.callback.verify_failed", { message: error.message });
      return errorPage("verify_failed", error.message);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.warn("auth.callback.exchange_failed", { message: error.message });
      return errorPage("exchange_failed", error.message);
    }
  } else {
    // Nothing usable in the query string. The tokens may still be in the
    // fragment, which only the browser can see — hand off rather than fail.
    const finish = new URL("/auth/finish", origin);
    finish.searchParams.set("next", safeNext);
    return NextResponse.redirect(finish);
  }

  // `x-forwarded-host` is what Netlify sets; trust it for the redirect target
  // so the user lands back on the production domain, not the internal one.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;

  return NextResponse.redirect(`${base}${safeNext}`);
}
