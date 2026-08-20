import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { detectRecurringExpenses, detectRecurringIncome } from "@/lib/finance/recurrence";
import { mapTransaction } from "./context";
import { logger } from "@/lib/logger";

/**
 * Refreshes the "possible recurring expense" list after a sync.
 *
 * Detected streams are NEVER silently promoted into committed bills — they are
 * written as `pending` candidates that the user confirms or dismisses, and that
 * decision is remembered so we never nag about the same merchant twice.
 */
export async function refreshRecurringCandidates(
  userId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? createAdminSupabase();

  try {
    const since = new Date();
    since.setDate(since.getDate() - 210);

    const [{ data: txnRows }, { data: decided }, { data: obligations }] =
      await Promise.all([
        supabase
          .from("spendable_transactions")
          .select("*")
          .eq("user_id", userId)
          .gte("date", since.toISOString().slice(0, 10))
          .limit(4000),
        supabase
          .from("spendable_recurring_candidates")
          .select("merchant_key, status")
          .eq("user_id", userId)
          .neq("status", "pending"),
        supabase
          .from("spendable_recurring_obligations")
          .select("merchant_key")
          .eq("user_id", userId),
      ]);

    if (!txnRows || txnRows.length === 0) return 0;

    const transactions = txnRows.map(mapTransaction);

    // Anything the user already confirmed or dismissed is off the table.
    const exclude = new Set<string>();
    for (const row of decided ?? []) {
      if (row.merchant_key) exclude.add(row.merchant_key as string);
    }
    for (const row of obligations ?? []) {
      if (row.merchant_key) exclude.add(row.merchant_key as string);
    }

    const asOf = new Date();
    const expenses = detectRecurringExpenses(transactions, asOf, {
      excludeMerchantKeys: exclude,
    }).slice(0, 25);

    const incomes = detectRecurringIncome(transactions, asOf, {
      excludeMerchantKeys: exclude,
    }).slice(0, 5);

    const rows = expenses.map((candidate) => ({
      user_id: userId,
      merchant_key: candidate.merchantKey,
      display_name: candidate.displayName,
      average_amount: candidate.averageAmount,
      frequency: candidate.frequency,
      confidence: candidate.confidence,
      occurrence_count: candidate.occurrenceCount,
      first_seen_date: candidate.firstSeenDate,
      last_seen_date: candidate.lastSeenDate,
      next_predicted_date: candidate.nextPredictedDate,
      status: "pending" as const,
      detected_via: "heuristic" as const,
    }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("spendable_recurring_candidates")
        .upsert(rows, {
          onConflict: "user_id,merchant_key,frequency",
          // A user's pending row keeps its identity; only the stats update.
          ignoreDuplicates: false,
        });
      if (error) {
        logger.warn("recurring.candidates.persist_failed", {
          message: error.message,
        });
      }
    }

    // Suggest detected income only when the user has no income source yet,
    // so we never quietly inflate their expected income.
    if (incomes.length > 0) {
      const { count } = await supabase
        .from("spendable_income_sources")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if ((count ?? 0) === 0) {
        const best = incomes[0];
        await supabase.from("spendable_income_sources").insert({
          user_id: userId,
          name: best.displayName,
          expected_net_amount: best.averageAmount,
          frequency: best.frequency,
          next_expected_date: best.nextPredictedDate,
          merchant_key: best.merchantKey,
          source: "detected",
          // Inactive until the user confirms it on the Plan screen.
          is_active: false,
        });
      }
    }

    return rows.length;
  } catch (error) {
    logger.warn("recurring.refresh_failed", {
      userId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return 0;
  }
}
