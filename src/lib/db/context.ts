import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";
import { createServerSupabase } from "@/lib/supabase/server";
import { toISODate } from "@/lib/finance/dates";
import type {
  Account,
  FinancialContext,
  Goal,
  IncomeSource,
  LiabilityDetail,
  ManualLiability,
  PlannedExpense,
  RecurringObligation,
  Transaction,
} from "@/lib/finance/types";

/**
 * Assembles the FinancialContext the engine operates on.
 *
 * Deliberately bounded: only the transaction history the engine actually needs
 * is loaded (enough for the current month plus recurrence detection), never the
 * entire table. Aggregation for the Activity screen is paginated separately.
 */

const HISTORY_DAYS = 210; // ~7 months: current month + 6 for pattern detection

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  currency: string;
  timezone: string;
  cash_buffer: number;
  necessary_monthly_allowance: number;
  forecast_days: number;
  onboarding_completed_at: string | null;
  demo_mode: boolean;
}

export async function getProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileRow> {
  const { data } = await supabase
    .from("spendable_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (data) return data as ProfileRow;

  // The signup trigger normally creates this. Self-heal if it is missing so a
  // user is never stuck on a broken screen.
  const fallback = {
    user_id: userId,
    display_name: null,
    currency: "USD",
    timezone: "America/New_York",
    cash_buffer: 1000,
    necessary_monthly_allowance: 600,
    forecast_days: 35,
    onboarding_completed_at: null,
    demo_mode: false,
  };

  await supabase.from("spendable_profiles").upsert(fallback, { onConflict: "user_id" });
  return fallback as ProfileRow;
}

export async function loadFinancialContext(
  userId: string,
  asOf: Date = new Date(),
  client?: SupabaseClient,
): Promise<FinancialContext> {
  const supabase = client ?? (await createServerSupabase());
  const historyStart = toISODate(subDays(asOf, HISTORY_DAYS));
  const monthStart = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}-01`;

  const [
    profile,
    accountsResult,
    transactionsResult,
    liabilitiesResult,
    manualLiabilitiesResult,
    obligationsResult,
    incomeResult,
    goalsResult,
    plannedResult,
    planOverrideResult,
  ] = await Promise.all([
    getProfile(supabase, userId),
    supabase.from("spendable_accounts").select("*").eq("user_id", userId),
    supabase
      .from("spendable_transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", historyStart)
      .order("date", { ascending: false })
      .limit(4000),
    supabase.from("spendable_liabilities").select("*").eq("user_id", userId),
    supabase.from("spendable_manual_liabilities").select("*").eq("user_id", userId),
    supabase.from("spendable_recurring_obligations").select("*").eq("user_id", userId),
    supabase.from("spendable_income_sources").select("*").eq("user_id", userId),
    supabase.from("spendable_goals").select("*").eq("user_id", userId),
    supabase
      .from("spendable_planned_expenses")
      .select("*")
      .eq("user_id", userId)
      .eq("is_settled", false),
    supabase
      .from("spendable_monthly_plans")
      .select("*")
      .eq("user_id", userId)
      .eq("month_start", monthStart)
      .maybeSingle(),
  ]);

  const accounts = (accountsResult.data ?? []).map(mapAccount);
  const transactions = (transactionsResult.data ?? []).map(mapTransaction);

  return {
    asOf,
    profile: {
      cashBuffer: Number(profile.cash_buffer),
      necessaryMonthlyAllowance: Number(profile.necessary_monthly_allowance),
      forecastDays: Number(profile.forecast_days),
      currency: profile.currency,
    },
    accounts,
    transactions,
    liabilities: (liabilitiesResult.data ?? []).map(mapLiability),
    manualLiabilities: (manualLiabilitiesResult.data ?? []).map(mapManualLiability),
    recurringObligations: (obligationsResult.data ?? []).map(mapObligation),
    incomeSources: (incomeResult.data ?? []).map(mapIncome),
    goals: (goalsResult.data ?? []).map(mapGoal),
    plannedExpenses: (plannedResult.data ?? []).map(mapPlannedExpense),
    monthlyPlanOverride: planOverrideResult.data
      ? {
          expectedIncome: numberOrNull(planOverrideResult.data.expected_income_override),
          necessaryAllowance: numberOrNull(
            planOverrideResult.data.necessary_allowance_override,
          ),
          goalContribution: numberOrNull(
            planOverrideResult.data.goal_contribution_override,
          ),
          debtPayment: numberOrNull(planOverrideResult.data.debt_payment_override),
          buffer: numberOrNull(planOverrideResult.data.buffer_override),
        }
      : null,
    dataThrough: freshestTimestamp(accounts),
  };
}

/** Newest balance timestamp across accounts, for the "Updated X ago" label. */
function freshestTimestamp(accounts: Account[]): string | null {
  const stamps = accounts
    .map((a) => a.balanceLastUpdatedAt)
    .filter((s): s is string => Boolean(s))
    .sort();
  return stamps.length > 0 ? stamps[stamps.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case -> camelCase, numeric -> number)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function mapAccount(row: Row): Account {
  return {
    id: row.id as string,
    name: row.name as string,
    officialName: (row.official_name as string) ?? null,
    institutionName: (row.institution_name as string) ?? null,
    mask: (row.mask as string) ?? null,
    type: row.type as Account["type"],
    subtype: (row.subtype as string) ?? null,
    source: row.source as "plaid" | "manual",
    currentBalance: numberOrNull(row.current_balance),
    availableBalance: numberOrNull(row.available_balance),
    creditLimit: numberOrNull(row.credit_limit),
    isLiquid: Boolean(row.is_liquid),
    isActive: Boolean(row.is_active),
    paymentStrategy: row.payment_strategy as Account["paymentStrategy"],
    paymentFixedAmount: numberOrNull(row.payment_fixed_amount),
    balanceLastUpdatedAt: (row.balance_last_updated_at as string) ?? null,
  };
}

export function mapTransaction(row: Row): Transaction {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    plaidTransactionId: (row.plaid_transaction_id as string) ?? null,
    pendingTransactionId: (row.pending_transaction_id as string) ?? null,
    amount: num(row.amount),
    date: row.date as string,
    name: row.name as string,
    merchantName: (row.merchant_name as string) ?? null,
    merchantKey: (row.merchant_key as string) ?? null,
    pending: Boolean(row.pending),
    classification: row.classification as Transaction["classification"],
    subcategory: (row.subcategory as string) ?? null,
    plaidCategoryPrimary: (row.plaid_category_primary as string) ?? null,
    plaidCategoryDetailed: (row.plaid_category_detailed as string) ?? null,
    classificationLocked: Boolean(row.classification_locked),
    isRefund: Boolean(row.is_refund),
  };
}

export function mapLiability(row: Row): LiabilityDetail {
  return {
    accountId: row.account_id as string,
    liabilityType: row.liability_type as LiabilityDetail["liabilityType"],
    lastStatementBalance: numberOrNull(row.last_statement_balance),
    minimumPayment: numberOrNull(row.minimum_payment),
    nextPaymentDueDate: (row.next_payment_due_date as string) ?? null,
    aprPercentage: numberOrNull(row.apr_percentage),
    outstandingBalance: numberOrNull(row.outstanding_balance),
    lastPaymentAmount: numberOrNull(row.last_payment_amount),
    lastPaymentDate: (row.last_payment_date as string) ?? null,
  };
}

export function mapManualLiability(row: Row): ManualLiability {
  return {
    id: row.id as string,
    name: row.name as string,
    liabilityType: row.liability_type as string,
    institutionName: (row.institution_name as string) ?? null,
    currentBalance: num(row.current_balance),
    aprPercentage: numberOrNull(row.apr_percentage),
    minimumMonthlyPayment: num(row.minimum_monthly_payment),
    plannedMonthlyPayment: num(row.planned_monthly_payment),
    paymentDueDay: numberOrNull(row.payment_due_day),
    isActive: Boolean(row.is_active),
    balanceLastUpdatedAt: row.balance_last_updated_at as string,
  };
}

export function mapObligation(row: Row): RecurringObligation {
  return {
    id: row.id as string,
    name: row.name as string,
    amount: num(row.amount),
    frequency: row.frequency as RecurringObligation["frequency"],
    nextDueDate: row.next_due_date as string,
    category: row.category as RecurringObligation["category"],
    isEssential: Boolean(row.is_essential),
    autopay: Boolean(row.autopay),
    accountId: (row.account_id as string) ?? null,
    merchantKey: (row.merchant_key as string) ?? null,
    source: row.source as "manual" | "detected",
    isActive: Boolean(row.is_active),
  };
}

export function mapIncome(row: Row): IncomeSource {
  return {
    id: row.id as string,
    name: row.name as string,
    expectedNetAmount: num(row.expected_net_amount),
    frequency: row.frequency as IncomeSource["frequency"],
    nextExpectedDate: (row.next_expected_date as string) ?? null,
    accountId: (row.account_id as string) ?? null,
    merchantKey: (row.merchant_key as string) ?? null,
    isActive: Boolean(row.is_active),
    source: row.source as "manual" | "detected",
  };
}

export function mapGoal(row: Row): Goal {
  return {
    id: row.id as string,
    name: row.name as string,
    goalType: row.goal_type as string,
    currentAmount: num(row.current_amount),
    targetAmount: numberOrNull(row.target_amount),
    targetDate: (row.target_date as string) ?? null,
    priority: num(row.priority, 3),
    desiredMonthlyContribution: num(row.desired_monthly_contribution),
    accountId: (row.account_id as string) ?? null,
    contributionsLeaveChecking: Boolean(row.contributions_leave_checking),
    isActive: Boolean(row.is_active),
    notes: (row.notes as string) ?? null,
  };
}

export function mapPlannedExpense(row: Row): PlannedExpense {
  return {
    id: row.id as string,
    name: row.name as string,
    amount: num(row.amount),
    expectedDate: row.expected_date as string,
    classification: row.classification as PlannedExpense["classification"],
    isReserved: Boolean(row.is_reserved),
    isSettled: Boolean(row.is_settled),
  };
}
