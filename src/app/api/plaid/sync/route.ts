import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { syncAllForUser } from "@/lib/plaid/sync";
import { refreshRecurringCandidates } from "@/lib/db/recurring";
import { isPlaidConfigured } from "@/lib/plaid/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** User-facing "Sync now". */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isPlaidConfigured()) {
    // Manual-mode users still get their detected-recurring list refreshed.
    await refreshRecurringCandidates(user.id);
    return NextResponse.json({ itemCount: 0, failed: 0, setupRequired: true });
  }

  try {
    const results = await syncAllForUser(user.id, "manual");
    await refreshRecurringCandidates(user.id);

    return NextResponse.json({
      itemCount: results.length,
      failed: results.filter((r) => r.status === "failed").length,
      added: results.reduce((sum, r) => sum + r.added, 0),
    });
  } catch (error) {
    logger.error("sync.manual.failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "We couldn't refresh right now. Your previous data is still available." },
      { status: 502 },
    );
  }
}
