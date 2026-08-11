import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, subDays, subMonths } from "date-fns";
import { merchantKeyFor } from "@/lib/finance/classify";
import { toISODate } from "@/lib/finance/dates";
import type { Classification } from "@/lib/finance/types";

/**
 * Realistic demo data, using obviously fake institutions and merchants.
 *
 * All rows are written with `source: 'manual'` and institution names prefixed
 * "Demo", so they are visually distinguishable from real synced data and can
 * be removed wholesale. Demo data never mixes with Plaid-sourced records —
 * clearing it only removes manual rows tagged as demo.
 */

const DEMO_INSTITUTION = "Demo Bank";
const DEMO_LENDER = "Demo Servicing";

interface SeedSummary {
  accounts: number;
  transactions: number;
  goals: number;
  obligations: number;
}

/**
 * Insert, and fail loudly if the database refuses.
 *
 * supabase-js reports errors in the result rather than throwing, so an
 * unchecked insert silently does nothing — a missing RLS policy then surfaces
 * as an unrelated crash further down, or as no data and no complaint at all.
 * Naming the table in the message is what makes that diagnosable.
 */
async function insertOrThrow(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<void> {
  // `defaultToNull: false` matters whenever the rows are not all the same
  // shape. PostgREST inserts the union of every key it sees, so by default a
  // row that omits a key is sent an explicit null — which defeats the column
  // default and trips any NOT NULL constraint. This makes an omitted key mean
  // "use the default", which is what the seed data assumes.
  const { error } = await supabase.from(table).insert(rows, {
    defaultToNull: false,
  });
  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
}

export async function seedDemoData(
  supabase: SupabaseClient,
  userId: string,
): Promise<SeedSummary> {
  // Start clean so seeding twice does not double everything up.
  await clearDemoData(supabase, userId);

  const today = new Date();
  const now = today.toISOString();

  // --- Accounts ------------------------------------------------------------
  const accountRows = [
    {
      user_id: userId,
      source: "manual",
      name: "Everyday Checking",
      institution_name: DEMO_INSTITUTION,
      mask: "4412",
      type: "depository",
      subtype: "checking",
      current_balance: 4820.36,
      available_balance: 4820.36,
      is_liquid: true,
      balance_last_updated_at: now,
    },
    {
      user_id: userId,
      source: "manual",
      name: "Savings",
      institution_name: DEMO_INSTITUTION,
      mask: "8890",
      type: "depository",
      subtype: "savings",
      current_balance: 9240.0,
      available_balance: 9240.0,
      is_liquid: false,
      balance_last_updated_at: now,
    },
    {
      user_id: userId,
      source: "manual",
      name: "Everyday Rewards Card",
      institution_name: DEMO_INSTITUTION,
      mask: "3317",
      type: "credit",
      subtype: "credit card",
      current_balance: 1284.55,
      credit_limit: 9000,
      is_liquid: false,
      payment_strategy: "statement_balance",
      balance_last_updated_at: now,
    },
    {
      user_id: userId,
      source: "manual",
      name: "Travel Card",
      institution_name: DEMO_INSTITUTION,
      mask: "7702",
      type: "credit",
      subtype: "credit card",
      current_balance: 612.4,
      credit_limit: 6000,
      is_liquid: false,
      payment_strategy: "minimum_payment",
      balance_last_updated_at: now,
    },
  ];

  // The depository rows carry no payment strategy and the card rows carry no
  // available balance, so this insert needs the same defaulting as the rest.
  const { data: accounts, error: accountError } = await supabase
    .from("spendable_accounts")
    .insert(accountRows, { defaultToNull: false })
    .select("id, name, type");

  if (accountError) throw new Error(`spendable_accounts: ${accountError.message}`);

  const byName = new Map((accounts ?? []).map((a) => [a.name as string, a.id as string]));
  const checkingId = byName.get("Everyday Checking") as string;
  const savingsId = byName.get("Savings") as string;
  const rewardsId = byName.get("Everyday Rewards Card") as string;
  const travelId = byName.get("Travel Card") as string;

  // --- Liability detail for the cards --------------------------------------
  await insertOrThrow(supabase, "spendable_liabilities", [
    {
      user_id: userId,
      account_id: rewardsId,
      liability_type: "credit",
      last_statement_balance: 1102.18,
      minimum_payment: 35,
      next_payment_due_date: toISODate(addDays(today, 8)),
      apr_percentage: 22.99,
      synced_at: now,
    },
    {
      user_id: userId,
      account_id: travelId,
      liability_type: "credit",
      last_statement_balance: 612.4,
      minimum_payment: 25,
      next_payment_due_date: toISODate(addDays(today, 16)),
      apr_percentage: 19.24,
      synced_at: now,
    },
  ]);

  // --- Manual debt ---------------------------------------------------------
  await insertOrThrow(supabase, "spendable_manual_liabilities", {
    user_id: userId,
    name: "Student Loan",
    liability_type: "student_loan",
    institution_name: DEMO_LENDER,
    current_balance: 18450,
    apr_percentage: 5.35,
    minimum_monthly_payment: 265,
    planned_monthly_payment: 300,
    payment_due_day: 20,
    notes: "Demo data — replace with your real loan details.",
    balance_last_updated_at: now,
  });

  // --- Income --------------------------------------------------------------
  await insertOrThrow(supabase, "spendable_income_sources", {
    user_id: userId,
    name: "Paycheck — Northwind Studio",
    expected_net_amount: 2640,
    frequency: "biweekly",
    next_expected_date: toISODate(nextWeekday(today, 5)),
    account_id: checkingId,
    merchant_key: merchantKeyFor("Northwind Studio Payroll", null),
    source: "manual",
    is_active: true,
  });

  // --- Recurring obligations ----------------------------------------------
  const obligations = [
    {
      name: "Rent",
      amount: 2150,
      category: "fixed",
      day: 1,
      essential: true,
      merchant: "Harborview Apartments",
    },
    {
      name: "Electric",
      amount: 96,
      category: "fixed",
      day: 12,
      essential: true,
      merchant: "Citywide Power",
    },
    {
      name: "Phone",
      amount: 68,
      category: "fixed",
      day: 6,
      essential: true,
      merchant: "Vantage Mobile",
    },
    {
      name: "Renters insurance",
      amount: 21,
      category: "fixed",
      day: 14,
      essential: true,
      merchant: "Keelson Insurance",
    },
    {
      name: "Gym membership",
      amount: 215,
      category: "fun",
      day: 12,
      essential: false,
      merchant: "Ironline Fitness",
    },
    {
      name: "Streaming bundle",
      amount: 24.99,
      category: "fun",
      day: 9,
      essential: false,
      merchant: "Cineloop",
    },
    {
      name: "Music subscription",
      amount: 11.99,
      category: "fun",
      day: 22,
      essential: false,
      merchant: "Tonewave",
    },
  ];

  await insertOrThrow(supabase, "spendable_recurring_obligations", 
    obligations.map((o) => ({
      user_id: userId,
      name: o.name,
      amount: o.amount,
      frequency: "monthly",
      next_due_date: toISODate(nextDayOfMonthDate(o.day, today)),
      category: o.category,
      is_essential: o.essential,
      autopay: true,
      merchant_key: merchantKeyFor(o.merchant, null),
      source: "manual",
      is_active: true,
    })),
  );

  // --- Goals ---------------------------------------------------------------
  await insertOrThrow(supabase, "spendable_goals", [
    {
      user_id: userId,
      name: "Emergency Fund",
      goal_type: "emergency_fund",
      current_amount: 2300,
      target_amount: 10000,
      target_date: "2027-12-01",
      priority: 1,
      desired_monthly_contribution: 400,
      account_id: savingsId,
      contributions_leave_checking: true,
      notes: "Three months of essential expenses.",
      is_active: true,
    },
    {
      user_id: userId,
      name: "2027 Savings Target",
      goal_type: "savings",
      current_amount: 6940,
      target_amount: 25000,
      target_date: "2027-12-31",
      priority: 2,
      desired_monthly_contribution: 350,
      account_id: savingsId,
      contributions_leave_checking: true,
      is_active: true,
    },
    {
      user_id: userId,
      name: "Card payoff",
      goal_type: "debt_payoff",
      current_amount: 0,
      target_amount: 1284.55,
      target_date: "2027-03-01",
      priority: 3,
      desired_monthly_contribution: 0,
      contributions_leave_checking: false,
      is_active: true,
    },
  ]);

  // --- One-time planned expense -------------------------------------------
  await insertOrThrow(supabase, "spendable_planned_expenses", {
    user_id: userId,
    name: "Flight home for the holidays",
    amount: 385,
    expected_date: toISODate(addDays(today, 24)),
    classification: "fun",
    is_reserved: false,
  });

  // --- Transactions --------------------------------------------------------
  const transactions = buildDemoTransactions(userId, today, {
    checkingId,
    savingsId,
    rewardsId,
    travelId,
  });

  const { error: txnError } = await supabase
    .from("spendable_transactions")
    .insert(transactions);
  if (txnError) throw new Error(txnError.message);

  await supabase
    .from("spendable_profiles")
    .update({
      demo_mode: true,
      onboarding_completed_at: now,
      cash_buffer: 1000,
      necessary_monthly_allowance: 650,
    })
    .eq("user_id", userId);

  return {
    accounts: accountRows.length,
    transactions: transactions.length,
    goals: 3,
    obligations: obligations.length,
  };
}

interface DemoAccounts {
  checkingId: string;
  savingsId: string;
  rewardsId: string;
  travelId: string;
}

interface DemoTxn {
  user_id: string;
  account_id: string;
  source: "manual";
  amount: number;
  date: string;
  name: string;
  merchant_name: string;
  merchant_key: string;
  pending: boolean;
  classification: Classification;
  subcategory: string | null;
  is_refund: boolean;
}

/**
 * Builds ~4 months of plausible history, including the cases the engine has to
 * get right: a credit-card payment pair, a savings transfer, a refund, and a
 * pending charge.
 */
function buildDemoTransactions(
  userId: string,
  today: Date,
  accounts: DemoAccounts,
): DemoTxn[] {
  const rows: DemoTxn[] = [];

  const push = (
    accountId: string,
    amount: number,
    date: Date,
    name: string,
    classification: Classification,
    subcategory: string | null = null,
    extra: { pending?: boolean; isRefund?: boolean } = {},
  ) => {
    rows.push({
      user_id: userId,
      account_id: accountId,
      source: "manual",
      amount,
      date: toISODate(date),
      name,
      merchant_name: name,
      merchant_key: merchantKeyFor(name, null),
      pending: extra.pending ?? false,
      classification,
      subcategory,
      is_refund: extra.isRefund ?? false,
    });
  };

  // Four months of recurring history so the detector has something to find.
  for (let monthsAgo = 3; monthsAgo >= 0; monthsAgo -= 1) {
    const base = subMonths(today, monthsAgo);

    // Paychecks, twice a month.
    push(accounts.checkingId, 2640, dayOf(base, 5), "Northwind Studio Payroll", "income", "Income");
    push(accounts.checkingId, 2640, dayOf(base, 19), "Northwind Studio Payroll", "income", "Income");

    // Fixed bills.
    push(accounts.checkingId, -2150, dayOf(base, 1), "Harborview Apartments", "fixed", "Housing");
    push(accounts.checkingId, -96, dayOf(base, 12), "Citywide Power", "fixed", "Housing");
    push(accounts.checkingId, -68, dayOf(base, 6), "Vantage Mobile", "fixed", "Housing");
    push(accounts.checkingId, -21, dayOf(base, 14), "Keelson Insurance", "fixed", "Housing");

    // Subscriptions on the rewards card — the recurring detector's target.
    push(accounts.rewardsId, -215, dayOf(base, 12), "Ironline Fitness", "fun", "Personal care");
    push(accounts.rewardsId, -24.99, dayOf(base, 9), "Cineloop", "fun", "Subscriptions");
    push(accounts.rewardsId, -11.99, dayOf(base, 22), "Tonewave", "fun", "Subscriptions");

    // Groceries, weekly-ish.
    push(accounts.rewardsId, -128.4, dayOf(base, 3), "Marisol Market", "necessary", "Groceries");
    push(accounts.rewardsId, -96.15, dayOf(base, 11), "Marisol Market", "necessary", "Groceries");
    push(accounts.rewardsId, -142.8, dayOf(base, 18), "Marisol Market", "necessary", "Groceries");
    push(accounts.rewardsId, -87.22, dayOf(base, 25), "Marisol Market", "necessary", "Groceries");

    // Transport.
    push(accounts.checkingId, -62, dayOf(base, 8), "Metro Transit Pass", "necessary", "Transportation");
    push(accounts.rewardsId, -41.5, dayOf(base, 21), "Cobalt Rideshare", "necessary", "Transportation");

    // Discretionary.
    push(accounts.rewardsId, -64.3, dayOf(base, 7), "Rosetta Bistro", "fun", "Dining");
    push(accounts.rewardsId, -38.75, dayOf(base, 15), "Copper Kettle Coffee", "fun", "Dining");
    push(accounts.travelId, -119.99, dayOf(base, 17), "Lumen Outfitters", "fun", "Shopping");

    // Debt + savings movements.
    push(accounts.checkingId, -300, dayOf(base, 20), "Demo Servicing Loan Payment", "fixed", "Debt");
    push(accounts.checkingId, -400, dayOf(base, 2), "Transfer to Savings", "goals", null);
    push(accounts.savingsId, 400, dayOf(base, 2), "Transfer from Checking", "transfer", null);

    // Credit-card payment: cash leaves checking, credit lands on the card.
    // Classified as transfers so it is NOT counted as a second expense on top
    // of the purchases it settles.
    push(accounts.checkingId, -820, dayOf(base, 16), "Everyday Rewards Card Payment", "transfer", null);
    push(accounts.rewardsId, 820, dayOf(base, 16), "Payment Thank You", "transfer", null);
  }

  // A refund this month: reduces net fun spending, and is not income.
  push(accounts.travelId, -142.0, subDays(today, 12), "Lumen Outfitters", "fun", "Shopping");
  push(accounts.travelId, 142.0, subDays(today, 4), "Lumen Outfitters Refund", "fun", "Shopping", {
    isRefund: true,
  });

  // A pending charge that has not posted yet.
  push(accounts.rewardsId, -53.6, subDays(today, 1), "Rosetta Bistro", "fun", "Dining", {
    pending: true,
  });

  return rows;
}

/** Removes every demo record, leaving Plaid-synced data untouched. */
export async function clearDemoData(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: demoAccounts } = await supabase
    .from("spendable_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "manual")
    .in("institution_name", [DEMO_INSTITUTION, DEMO_LENDER]);

  const ids = (demoAccounts ?? []).map((a) => a.id as string);

  if (ids.length > 0) {
    // Transactions and liabilities cascade from the account rows.
    await supabase
      .from("spendable_transactions")
      .delete()
      .eq("user_id", userId)
      .in("account_id", ids);
    await supabase.from("spendable_accounts").delete().eq("user_id", userId).in("id", ids);
  }

  await supabase
    .from("spendable_manual_liabilities")
    .delete()
    .eq("user_id", userId)
    .eq("institution_name", DEMO_LENDER);

  await supabase
    .from("spendable_income_sources")
    .delete()
    .eq("user_id", userId)
    .like("name", "Paycheck — Northwind%");

  await supabase
    .from("spendable_recurring_obligations")
    .delete()
    .eq("user_id", userId)
    .in("name", [
      "Rent",
      "Electric",
      "Phone",
      "Renters insurance",
      "Gym membership",
      "Streaming bundle",
      "Music subscription",
    ]);

  await supabase
    .from("spendable_goals")
    .delete()
    .eq("user_id", userId)
    .in("name", ["Emergency Fund", "2027 Savings Target", "Card payoff"]);

  await supabase
    .from("spendable_planned_expenses")
    .delete()
    .eq("user_id", userId)
    .eq("name", "Flight home for the holidays");

  await supabase
    .from("spendable_recurring_candidates")
    .delete()
    .eq("user_id", userId);

  await supabase
    .from("spendable_profiles")
    .update({ demo_mode: false })
    .eq("user_id", userId);
}

function dayOf(base: Date, day: number): Date {
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(day, lastDay), 12);
}

function nextDayOfMonthDate(day: number, from: Date): Date {
  const candidate = dayOf(from, day);
  if (candidate >= new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)) {
    return candidate;
  }
  return dayOf(new Date(from.getFullYear(), from.getMonth() + 1, 1), day);
}

function nextWeekday(from: Date, weekday: number): Date {
  const result = new Date(from);
  const delta = (weekday - result.getDay() + 7) % 7 || 7;
  return addDays(result, delta);
}
