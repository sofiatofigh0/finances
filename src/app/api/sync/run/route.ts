import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { syncItem, type PlaidItemRow } from "@/lib/plaid/sync";
import { refreshRecurringCandidates } from "@/lib/db/recurring";
import { serverEnv } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import { isPlaidConfigured } from "@/lib/plaid/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Scheduled financial sync, invoked by the Netlify Scheduled Function.
 *
 * Webhooks remain the primary, event-driven mechanism. This is the
 * reliability fallback: it finds Items that have not synced recently, refreshes
 * them, and records success or failure. Every operation is idempotent, so
 * overlapping with a webhook is harmless.
 */
export async function POST(request: Request) {
  const expected = serverEnv.syncSecret;
  if (!expected) {
    return NextResponse.json(
      { error: "SYNC_JOB_SECRET is not configured." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-sync-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    logger.warn("sync.scheduled.unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPlaidConfigured()) {
    return NextResponse.json({ synced: 0, skipped: "plaid_not_configured" });
  }

  const supabase = createAdminSupabase();

  // Only touch Items that are stale, so the job stays cheap and does not
  // hammer institutions that a webhook already refreshed.
  const staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("spendable_plaid_items")
    .select(
      "id, user_id, plaid_item_id, access_token_encrypted, institution_name, transactions_cursor, status, last_synced_at",
    )
    .in("status", ["active", "error"])
    .or(`last_synced_at.is.null,last_synced_at.lt.${staleBefore}`)
    .limit(50);

  if (error) {
    logger.error("sync.scheduled.query_failed", { message: error.message });
    return NextResponse.json({ error: "Could not list items." }, { status: 500 });
  }

  const items = (data ?? []) as PlaidItemRow[];
  let succeeded = 0;
  let failed = 0;
  const touchedUsers = new Set<string>();

  for (const item of items) {
    const result = await syncItem(item, "scheduled");
    if (result.status === "success") succeeded += 1;
    else failed += 1;
    touchedUsers.add(item.user_id);
  }

  for (const userId of touchedUsers) {
    await refreshRecurringCandidates(userId, supabase);
  }

  logger.info("sync.scheduled.complete", {
    considered: items.length,
    succeeded,
    failed,
  });

  return NextResponse.json({ considered: items.length, succeeded, failed });
}
