"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase, getSessionUser } from "@/lib/supabase/server";
import { merchantKeyFor } from "@/lib/finance/classify";
import { logger } from "@/lib/logger";

/**
 * Server actions for every user-owned record.
 *
 * All of these run through the user's own Supabase session, so Row Level
 * Security is the enforcement boundary — an action cannot touch another
 * user's row even if a client sent a foreign id.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const ok: ActionResult = { ok: true };
function fail(error: string): ActionResult {
  return { ok: false, error };
}

async function withUser<T>(
  handler: (
    userId: string,
    supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ) => Promise<T>,
): Promise<T | ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("You need to be signed in.");
  const supabase = await createServerSupabase();
  return handler(user.id, supabase);
}

function refreshAll() {
  revalidatePath("/", "layout");
}

function numberFrom(form: FormData, key: string, fallback = 0): number {
  const raw = form.get(key);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function stringFrom(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optionalString(form: FormData, key: string): string | null {
  const value = stringFrom(form, key);
  return value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Profile / planning assumptions
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  display_name: z.string().max(120).nullable(),
  cash_buffer: z.number().min(0).max(1_000_000),
  necessary_monthly_allowance: z.number().min(0).max(1_000_000),
  forecast_days: z.number().int().min(7).max(120),
});

export async function updateProfile(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const parsed = profileSchema.safeParse({
      display_name: optionalString(form, "display_name"),
      cash_buffer: numberFrom(form, "cash_buffer"),
      necessary_monthly_allowance: numberFrom(form, "necessary_monthly_allowance"),
      forecast_days: numberFrom(form, "forecast_days", 35),
    });

    if (!parsed.success) return fail("Those values don't look right.");

    const { error } = await supabase
      .from("spendable_profiles")
      .update(parsed.data)
      .eq("user_id", userId);

    if (error) return fail("We couldn't save your settings.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function completeOnboarding(): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) return fail("We couldn't finish setup.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function createManualAccount(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const name = stringFrom(form, "name");
    if (!name) return fail("Give the account a name.");

    const type = stringFrom(form, "type") || "depository";
    const balance = numberFrom(form, "current_balance");

    const { error } = await supabase.from("spendable_accounts").insert({
      user_id: userId,
      source: "manual",
      name,
      institution_name: optionalString(form, "institution_name"),
      type,
      subtype: optionalString(form, "subtype"),
      current_balance: balance,
      available_balance: type === "depository" ? balance : null,
      credit_limit: type === "credit" ? numberFrom(form, "credit_limit") || null : null,
      is_liquid: form.get("is_liquid") === "on",
      balance_last_updated_at: new Date().toISOString(),
    });

    if (error) {
      logger.warn("account.create_failed", { message: error.message });
      return fail("We couldn't add that account.");
    }
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function updateAccount(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = stringFrom(form, "id");
    if (!id) return fail("Missing account.");

    const patch: Record<string, unknown> = {
      is_liquid: form.get("is_liquid") === "on",
    };

    if (form.has("name")) patch.name = stringFrom(form, "name");
    if (form.has("payment_strategy")) {
      patch.payment_strategy = stringFrom(form, "payment_strategy");
      patch.payment_fixed_amount =
        patch.payment_strategy === "fixed_amount"
          ? numberFrom(form, "payment_fixed_amount")
          : null;
    }
    // Only manual accounts allow a hand-edited balance; a Plaid balance is
    // owned by the institution.
    if (form.has("current_balance")) {
      patch.current_balance = numberFrom(form, "current_balance");
      patch.balance_last_updated_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("spendable_accounts")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) return fail("We couldn't update that account.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deleteManualAccount(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = stringFrom(form, "id");
    const { error } = await supabase
      .from("spendable_accounts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .eq("source", "manual");
    if (error) return fail("We couldn't remove that account.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Manual liabilities
// ---------------------------------------------------------------------------

export async function saveManualLiability(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = optionalString(form, "id");
    const name = stringFrom(form, "name");
    if (!name) return fail("Give the debt a name.");

    const dueDay = numberFrom(form, "payment_due_day", 0);

    const payload = {
      user_id: userId,
      name,
      liability_type: stringFrom(form, "liability_type") || "other",
      institution_name: optionalString(form, "institution_name"),
      current_balance: numberFrom(form, "current_balance"),
      apr_percentage: form.get("apr_percentage")
        ? numberFrom(form, "apr_percentage")
        : null,
      minimum_monthly_payment: numberFrom(form, "minimum_monthly_payment"),
      planned_monthly_payment: numberFrom(form, "planned_monthly_payment"),
      payment_due_day: dueDay >= 1 && dueDay <= 31 ? dueDay : null,
      notes: optionalString(form, "notes"),
      balance_last_updated_at: new Date().toISOString(),
    };

    const { error } = id
      ? await supabase
          .from("spendable_manual_liabilities")
          .update(payload)
          .eq("id", id)
          .eq("user_id", userId)
      : await supabase.from("spendable_manual_liabilities").insert(payload);

    if (error) {
      logger.warn("manual_liability.save_failed", { message: error.message });
      return fail("We couldn't save that debt.");
    }
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deleteManualLiability(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_manual_liabilities")
      .delete()
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't remove that.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Recurring obligations
// ---------------------------------------------------------------------------

export async function saveObligation(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = optionalString(form, "id");
    const name = stringFrom(form, "name");
    const nextDue = stringFrom(form, "next_due_date");
    if (!name) return fail("Give the expense a name.");
    if (!nextDue) return fail("Pick the next due date.");

    const payload = {
      user_id: userId,
      name,
      amount: Math.abs(numberFrom(form, "amount")),
      frequency: stringFrom(form, "frequency") || "monthly",
      next_due_date: nextDue,
      category: stringFrom(form, "category") || "fixed",
      is_essential: form.get("is_essential") !== null,
      autopay: form.get("autopay") !== null,
      account_id: optionalString(form, "account_id"),
      merchant_key: optionalString(form, "merchant_key"),
      is_active: true,
      notes: optionalString(form, "notes"),
    };

    const { error } = id
      ? await supabase
          .from("spendable_recurring_obligations")
          .update(payload)
          .eq("id", id)
          .eq("user_id", userId)
      : await supabase.from("spendable_recurring_obligations").insert(payload);

    if (error) return fail("We couldn't save that expense.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deleteObligation(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_recurring_obligations")
      .delete()
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't remove that expense.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

/** Promotes a detected candidate into a committed recurring obligation. */
export async function confirmRecurringCandidate(
  form: FormData,
): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = stringFrom(form, "id");

    const { data: candidate } = await supabase
      .from("spendable_recurring_candidates")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!candidate) return fail("That suggestion is no longer available.");

    const { error } = await supabase.from("spendable_recurring_obligations").insert({
      user_id: userId,
      name: candidate.display_name,
      amount: Math.abs(Number(candidate.average_amount)),
      frequency: candidate.frequency,
      next_due_date:
        candidate.next_predicted_date ?? new Date().toISOString().slice(0, 10),
      category: stringFrom(form, "category") || "fixed",
      merchant_key: candidate.merchant_key,
      source: "detected",
      is_active: true,
    });

    if (error) return fail("We couldn't add that as a regular expense.");

    await supabase
      .from("spendable_recurring_candidates")
      .update({ status: "confirmed" })
      .eq("id", id)
      .eq("user_id", userId);

    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function dismissRecurringCandidate(
  form: FormData,
): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_recurring_candidates")
      .update({ status: "dismissed" })
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't save that.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export async function saveIncomeSource(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = optionalString(form, "id");
    const name = stringFrom(form, "name");
    if (!name) return fail("Give the income source a name.");

    const payload = {
      user_id: userId,
      name,
      expected_net_amount: Math.abs(numberFrom(form, "expected_net_amount")),
      frequency: stringFrom(form, "frequency") || "biweekly",
      next_expected_date: optionalString(form, "next_expected_date"),
      account_id: optionalString(form, "account_id"),
      is_active: true,
    };

    const { error } = id
      ? await supabase
          .from("spendable_income_sources")
          .update(payload)
          .eq("id", id)
          .eq("user_id", userId)
      : await supabase.from("spendable_income_sources").insert(payload);

    if (error) return fail("We couldn't save that income source.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deleteIncomeSource(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_income_sources")
      .delete()
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't remove that.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function saveGoal(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = optionalString(form, "id");
    const name = stringFrom(form, "name");
    if (!name) return fail("Give the goal a name.");

    const target = form.get("target_amount")
      ? Math.abs(numberFrom(form, "target_amount"))
      : null;

    const payload = {
      user_id: userId,
      name,
      goal_type: stringFrom(form, "goal_type") || "savings",
      current_amount: Math.abs(numberFrom(form, "current_amount")),
      target_amount: target,
      target_date: optionalString(form, "target_date"),
      priority: Math.min(5, Math.max(1, numberFrom(form, "priority", 3))),
      desired_monthly_contribution: Math.abs(
        numberFrom(form, "desired_monthly_contribution"),
      ),
      contributions_leave_checking:
        form.get("contributions_leave_checking") !== null,
      notes: optionalString(form, "notes"),
      is_active: true,
    };

    const { error } = id
      ? await supabase
          .from("spendable_goals")
          .update(payload)
          .eq("id", id)
          .eq("user_id", userId)
      : await supabase.from("spendable_goals").insert(payload);

    if (error) return fail("We couldn't save that goal.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deleteGoal(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_goals")
      .delete()
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't remove that goal.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// One-time planned expenses
// ---------------------------------------------------------------------------

export async function savePlannedExpense(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const id = optionalString(form, "id");
    const name = stringFrom(form, "name");
    const date = stringFrom(form, "expected_date");
    if (!name) return fail("Give the expense a name.");
    if (!date) return fail("Pick a date.");

    const payload = {
      user_id: userId,
      name,
      amount: Math.abs(numberFrom(form, "amount")),
      expected_date: date,
      classification: stringFrom(form, "classification") || "fun",
      is_reserved: form.get("is_reserved") !== null,
      notes: optionalString(form, "notes"),
    };

    const { error } = id
      ? await supabase
          .from("spendable_planned_expenses")
          .update(payload)
          .eq("id", id)
          .eq("user_id", userId)
      : await supabase.from("spendable_planned_expenses").insert(payload);

    if (error) return fail("We couldn't save that.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deletePlannedExpense(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_planned_expenses")
      .delete()
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't remove that.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Transaction classification + merchant rules
// ---------------------------------------------------------------------------

/**
 * Reclassifies a transaction. `scope=merchant` also stores a standing rule so
 * future purchases from the same merchant follow the user's choice.
 */
export async function reclassifyTransaction(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const transactionId = stringFrom(form, "transaction_id");
    const classification = stringFrom(form, "classification");
    const scope = stringFrom(form, "scope") || "single";

    if (!transactionId || !classification) return fail("Missing details.");

    const { data: transaction } = await supabase
      .from("spendable_transactions")
      .select("id, merchant_key, merchant_name, name")
      .eq("id", transactionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!transaction) return fail("That transaction is no longer available.");

    // `classification_locked` is what stops the next Plaid sync from reverting
    // the user's decision.
    const { error } = await supabase
      .from("spendable_transactions")
      .update({ classification, classification_locked: true })
      .eq("id", transactionId)
      .eq("user_id", userId);

    if (error) return fail("We couldn't update that transaction.");

    if (scope === "merchant") {
      const merchantKey =
        transaction.merchant_key ||
        merchantKeyFor(transaction.merchant_name, transaction.name);

      if (merchantKey) {
        await supabase.from("spendable_merchant_rules").upsert(
          {
            user_id: userId,
            merchant_key: merchantKey,
            display_name: transaction.merchant_name ?? transaction.name,
            classification,
          },
          { onConflict: "user_id,merchant_key" },
        );

        // Apply the new rule to existing unlocked transactions so the user
        // sees the effect immediately rather than only going forward.
        await supabase
          .from("spendable_transactions")
          .update({ classification })
          .eq("user_id", userId)
          .eq("merchant_key", merchantKey)
          .eq("classification_locked", false);
      }
    }

    refreshAll();
    return ok;
  })) as ActionResult;
}

export async function deleteMerchantRule(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const { error } = await supabase
      .from("spendable_merchant_rules")
      .delete()
      .eq("id", stringFrom(form, "id"))
      .eq("user_id", userId);
    if (error) return fail("We couldn't remove that rule.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Monthly plan overrides
// ---------------------------------------------------------------------------

export async function saveMonthlyPlan(form: FormData): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const monthStart = stringFrom(form, "month_start");
    if (!monthStart) return fail("Missing month.");

    const optionalNumber = (key: string) =>
      form.get(key) && String(form.get(key)).length > 0
        ? numberFrom(form, key)
        : null;

    const { error } = await supabase.from("spendable_monthly_plans").upsert(
      {
        user_id: userId,
        month_start: monthStart,
        expected_income_override: optionalNumber("expected_income_override"),
        necessary_allowance_override: optionalNumber("necessary_allowance_override"),
        goal_contribution_override: optionalNumber("goal_contribution_override"),
        debt_payment_override: optionalNumber("debt_payment_override"),
      },
      { onConflict: "user_id,month_start" },
    );

    if (error) return fail("We couldn't save this month's plan.");
    refreshAll();
    return ok;
  })) as ActionResult;
}

// ---------------------------------------------------------------------------
// Start over
// ---------------------------------------------------------------------------

/**
 * Clears everything the user entered by hand and reopens onboarding.
 *
 * Deliberately narrow: only hand-entered records go. Plaid-sourced accounts and
 * transactions are untouched, because re-linking an institution is disruptive
 * and is never what someone means by "reset my settings". Detected recurring
 * candidates are cleared too — including past dismissals — so detection gets to
 * propose afresh against the transaction history rather than staying silent
 * about merchants that were waved away under the old setup.
 */
export async function resetManualSetup(): Promise<ActionResult> {
  return (await withUser(async (userId, supabase) => {
    const scoped = <T>(promise: PromiseLike<{ error: T | null }>) => promise;

    const results = await Promise.all([
      scoped(supabase.from("spendable_goals").delete().eq("user_id", userId)),
      scoped(
        supabase.from("spendable_planned_expenses").delete().eq("user_id", userId),
      ),
      scoped(
        supabase.from("spendable_manual_liabilities").delete().eq("user_id", userId),
      ),
      scoped(
        supabase.from("spendable_recurring_candidates").delete().eq("user_id", userId),
      ),
      scoped(
        supabase
          .from("spendable_recurring_obligations")
          .delete()
          .eq("user_id", userId)
          .neq("source", "plaid"),
      ),
      scoped(
        supabase
          .from("spendable_income_sources")
          .delete()
          .eq("user_id", userId)
          .neq("source", "plaid"),
      ),
      scoped(
        supabase
          .from("spendable_accounts")
          .delete()
          .eq("user_id", userId)
          .eq("source", "manual"),
      ),
    ]);

    if (results.some((r) => r.error)) {
      return fail("We couldn't clear everything. Nothing else was changed.");
    }

    // Send the user back through setup with the defaults they first saw.
    const { error: profileError } = await supabase
      .from("spendable_profiles")
      .update({
        cash_buffer: 1000,
        necessary_monthly_allowance: 0,
        forecast_days: 35,
        onboarding_completed_at: null,
      })
      .eq("user_id", userId);

    if (profileError) {
      return fail("Your entries were cleared, but the settings didn't reset.");
    }

    refreshAll();
    return ok;
  })) as ActionResult;
}
