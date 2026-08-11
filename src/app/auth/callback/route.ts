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

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.warn("auth.callback.exchange_failed", { message: error.message });
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
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
