import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client. Bypasses RLS, so it is used only where a
 * privileged operation is genuinely required:
 *
 *   1. Writing/reading the encrypted Plaid access token column, which is
 *      revoked from the `authenticated` role entirely.
 *   2. Plaid webhook handling, which arrives with no user session.
 *   3. The scheduled sync job, which runs unattended.
 *
 * Every query made through this client MUST scope by user_id explicitly —
 * RLS is not there to catch a mistake.
 */
let cached: SupabaseClient | null = null;

export function createAdminSupabase(): SupabaseClient {
  const key = serverEnv.supabaseSecretKey;
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. It is required for Plaid token storage, " +
        "webhook processing, and scheduled sync.",
    );
  }
  if (cached) return cached;
  cached = createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
