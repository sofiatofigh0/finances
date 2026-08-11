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
    logger.error("demo.seed_failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "We couldn't load the demo data." },
      { status: 500 },
    );
  }
}
