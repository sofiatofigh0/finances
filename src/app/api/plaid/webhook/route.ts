import { NextResponse } from "next/server";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook";
import { getItemByPlaidId, syncItem } from "@/lib/plaid/sync";
import { refreshRecurringCandidates } from "@/lib/db/recurring";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isPlaidConfigured } from "@/lib/plaid/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Plaid webhook endpoint.
 *
 * Deployed at ${NEXT_PUBLIC_APP_URL}/api/plaid/webhook — the domain is never
 * hardcoded; the link-token creation reads it from the environment.
 *
 * Every delivery is verified against Plaid's JWT scheme before anything is
 * acted on, and every handler is idempotent so a redelivered webhook is a
 * no-op rather than a duplicate.
 */
export async function POST(request: Request) {
  if (!isPlaidConfigured()) {
    // Nothing to process, but acknowledge so Plaid stops retrying.
    return NextResponse.json({ received: true });
  }

  // The raw body is required: the signature covers its exact bytes.
  const rawBody = await request.text();

  const verification = await verifyPlaidWebhook(
    rawBody,
    request.headers.get("plaid-verification"),
  );

  if (!verification.verified) {
    logger.warn("plaid.webhook.rejected", { reason: verification.reason });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: { error_code?: string };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const { webhook_type: type, webhook_code: code, item_id: plaidItemId } = payload;

  if (!plaidItemId) {
    return NextResponse.json({ received: true });
  }

  const item = await getItemByPlaidId(plaidItemId);
  if (!item) {
    // An Item we no longer track (user disconnected). Acknowledge and stop.
    logger.info("plaid.webhook.unknown_item", { type, code });
    return NextResponse.json({ received: true });
  }

  logger.info("plaid.webhook.received", { type, code, itemRowId: item.id });

  try {
    switch (type) {
      case "TRANSACTIONS": {
        // SYNC_UPDATES_AVAILABLE is the modern signal; the historical/default
        // codes are handled the same way because /transactions/sync is
        // cursor-based and therefore safe to call at any time.
        if (
          code === "SYNC_UPDATES_AVAILABLE" ||
          code === "DEFAULT_UPDATE" ||
          code === "INITIAL_UPDATE" ||
          code === "HISTORICAL_UPDATE" ||
          code === "TRANSACTIONS_REMOVED"
        ) {
          await syncItem(item, "webhook");
          await refreshRecurringCandidates(item.user_id);
        }
        break;
      }

      case "LIABILITIES": {
        if (code === "DEFAULT_UPDATE") {
          await syncItem(item, "webhook");
        }
        break;
      }

      case "ITEM": {
        if (code === "ERROR") {
          const errorCode = payload.error?.error_code ?? null;
          const requiresReauth =
            errorCode === "ITEM_LOGIN_REQUIRED" || errorCode === "ITEM_ERROR";

          // Record the state; never delete history because a login expired.
          await createAdminSupabase()
            .from("spendable_plaid_items")
            .update({
              status: requiresReauth ? "needs_reauth" : "error",
              error_code: errorCode,
              error_message: requiresReauth
                ? "This institution needs you to sign in again. Your previous data is still available."
                : "We couldn't refresh this account. Your previous data is still available.",
            })
            .eq("id", item.id);
        } else if (code === "PENDING_EXPIRATION") {
          await createAdminSupabase()
            .from("spendable_plaid_items")
            .update({
              status: "needs_reauth",
              error_code: "PENDING_EXPIRATION",
              error_message:
                "Your connection to this institution is about to expire. Reconnect to keep it up to date.",
            })
            .eq("id", item.id);
        } else if (code === "USER_PERMISSION_REVOKED") {
          await createAdminSupabase()
            .from("spendable_plaid_items")
            .update({ status: "revoked", access_token_encrypted: "revoked" })
            .eq("id", item.id);
        } else if (code === "NEW_ACCOUNTS_AVAILABLE") {
          await createAdminSupabase()
            .from("spendable_plaid_items")
            .update({
              status: "needs_reauth",
              error_code: "NEW_ACCOUNTS_AVAILABLE",
              error_message:
                "New accounts are available at this institution. Reconnect to include them.",
            })
            .eq("id", item.id);
        }
        break;
      }

      default:
        // Unhandled but valid webhook types are acknowledged, not errored.
        break;
    }
  } catch (error) {
    logger.error("plaid.webhook.processing_failed", {
      type,
      code,
      itemRowId: item.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    // Returning 200 keeps Plaid from hammering us over a persistent bug; the
    // scheduled sync will pick the data up regardless.
    return NextResponse.json({ received: true, processed: false });
  }

  return NextResponse.json({ received: true, processed: true });
}
