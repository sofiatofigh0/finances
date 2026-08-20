import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { seedDemoData, clearDemoData } from "@/lib/demo/seed";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Loads clearly-fake demo data so every screen is interesting immediately.
 *
 * Demo records are written as manual-source rows into the signed-in user's own
 * account and are removable in one action, so they never mix with data synced
 * from a real institution.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!serverEnv.allowDemoSeed) {
    return NextResponse.json(
      { error: "Demo data is disabled in this environment." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const supabase = await createServerSupabase();

  try {
    if (body.action === "clear") {
      await clearDemoData(supabase, user.id);
      return NextResponse.json({ ok: true, cleared: true });
    }

    const summary = await seedDemoData(supabase, user.id);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("demo.seed_failed", { userId: user.id, message });
    // This route only exists when demo seeding is deliberately enabled, and it
    // writes nothing but fake data — so the underlying reason is more useful
    // returned than hidden. Real financial endpoints stay opaque.
    return NextResponse.json(
      { error: `We couldn't load the demo data — ${message}` },
      { status: 500 },
    );
  }
}
