import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Refreshes the Supabase session on every request and gates the app behind
 * authentication. Runs on the Edge under Netlify's Next.js runtime.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The Plaid webhook and
     * scheduled-sync endpoints are allow-listed inside updateSession because
     * they authenticate themselves rather than via a user session.
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
