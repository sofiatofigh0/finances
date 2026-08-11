import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Server Supabase client bound to the signed-in user's session.
 *
 * Uses the current @supabase/ssr cookie contract (getAll/setAll). The
 * deprecated auth-helpers packages are intentionally not used.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by middleware, so this is safe to skip.
          }
        },
      },
    },
  );
}

/**
 * Returns the authenticated user, or null. Always uses getUser() (which
 * revalidates the JWT with Supabase) rather than trusting the session cookie.
 */
export async function getSessionUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Whether a user is a guest exploring the public demo.
 *
 * Supabase marks anonymous sign-ins on the user record. Guests get the full
 * app over seeded fake data, but anything that costs money or touches a real
 * institution is closed to them.
 */
export function isGuest(user: { is_anonymous?: boolean } | null): boolean {
  return Boolean(user?.is_anonymous);
}

/** Throws if there is no signed-in user. For route handlers and actions. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return user;
}
