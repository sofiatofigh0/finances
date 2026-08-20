import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getItemsForUser, refreshBalances } from "@/lib/plaid/sync";
import { interpretPlaidError, isPlaidConfigured } from "@/lib/plaid/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Real-time balance refresh, without a full transaction sync. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlaidConfigured()) {
    return NextResponse.json({ refreshed: 0, setupRequired: true });
  }

  const items = await getItemsForUser(user.id);
  let refreshed = 0;
  let failed = 0;

  for (const item of items) {
    if (item.status === "revoked") continue;
    try {
      await refreshBalances(item);
      refreshed += 1;
    } catch (error) {
      failed += 1;
      logger.warn("plaid.balance_refresh.failed", {
        itemRowId: item.id,
        errorCode: interpretPlaidError(error).errorCode,
      });
    }
  }

  return NextResponse.json({ refreshed, failed });
}
