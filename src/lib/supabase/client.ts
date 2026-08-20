"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Browser Supabase client. Uses only the publishable (anon) key — every query
 * it makes is subject to Row Level Security.
 */
export function createClient() {
  return createBrowserClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
  );
}
