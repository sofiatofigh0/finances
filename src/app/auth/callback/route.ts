import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Magic-link / OTP callback. Supabase redirects here with a `code` which is
 * exchanged for a session cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Carry the real reason to the error page. Supabase reports a rejected token
  // here (expired, already used, redirect not allowed), and silently collapsing
  // every one of those into "that link didn't work" leaves nothing to act on.
  const errorPage = (reason: string, detail?: string | null) => {
    const url = new URL("/auth/auth-code-error", origin);
    url.searchParams.set("reason", reason);
    if (detail) url.searchParams.set("detail", detail.slice(0, 300));
    return NextResponse.redirect(url);
  };

  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) {
    logger.warn("auth.callback.provider_error", { code: providerError });
    return errorPage(providerError, searchParams.get("error_description"));
  }

  if (!code) {
    return errorPage("missing_code");
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.warn("auth.callback.exchange_failed", { message: error.message });
    return errorPage("exchange_failed", error.message);
  }

  // `x-forwarded-host` is what Netlify sets; trust it for the redirect target
  // so the user lands back on the production domain, not the internal one.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;

  // Only ever redirect to a path on our own origin.
  const safeNext = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(`${base}${safeNext}`);
}
