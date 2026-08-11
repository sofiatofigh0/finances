import { endOfMonth, startOfMonth } from "date-fns";
import {
  buildForecast,
  liquidBalance,
  round2,
} from "./cashflow";
import { dedupePendingPosted } from "./classify";
import {
  daysRemainingInMonth,
  monthBounds,
  toISODate,
  toMonthlyAmount,
} from "./dates";
import type {
  CashFlowEvent,
  Classification,
  FinancialContext,
  MonthlyPlan,
  SafeToSpendResult,
  SafeToSpendStatus,
  Transaction,
} from "./types";

/**
 * THE SAFE-TO-SPEND ENGINE.
 *
 * This module is the single source of truth for the number the whole product
 * exists to produce. It is deterministic, pure, and never touched by the LLM —
 * the agent may explain this result but can neither compute nor override it.
 *
 * Two independent constraints are computed and the tighter one wins:
 *
 *   A. The monthly plan.   Income minus every commitment leaves a fun budget;
 *                          subtract fun already spent.
 *   B. The liquidity guard. Project cash over the next ~35 days, find the
 *                          lowest point, and keep the cash buffer intact.
 *
 *   SafeToSpend = min(RemainingMonthlyFunBudget, AvailableLiquidityAboveBuffer)
 *
 * Either can be negative, and a negative value is surfaced as an overage
 * rather than clamped away.
 */

/** Transactions that fall inside the current calendar month, de-duplicated. */
export function currentMonthTransactions(
  context: FinancialContext,
): Transaction[] {
  const start = toISODate(startOfMonth(context.asOf));
  const end = toISODate(endOfMonth(context.asOf));
  return dedupePendingPosted(context.transactions).filter(
    (t) => t.date >= start && t.date <= end,
  );
}

/**
 * Net spend for a bucket this month, as a positive number.
 *
 * Because `amount` is signed, refunds inside the same bucket subtract
 * naturally: a $450 dress and a later $450 return net to zero fun spending.
 */
export function spentInBucket(
  transactions: Transaction[],
  bucket: Classification,
): number {
  const net = transactions
    .filter((t) => t.classification === bucket)
    .reduce((sum, t) => sum + t.amount, 0);
  // Outflows are negative, so negate to express "amount spent".
  return round2(-net);
}

export function receivedIncome(transactions: Transaction[]): number {
  return round2(
    transactions
      .filter((t) => t.classification === "income")
      .reduce((sum, t) => sum + t.amount, 0),
  );
}

/** Expected net income for the month, from confirmed income sources. */
export function expectedMonthlyIncome(context: FinancialContext): number {
  const override = context.monthlyPlanOverride?.expectedIncome;
  if (override != null) return override;

  return round2(
    context.incomeSources
      .filter((s) => s.isActive)
      .reduce(
        (sum, s) => sum + toMonthlyAmount(s.expectedNetAmount, s.frequency),
        0,
      ),
  );
}

/**
 * Monthly-equivalent value of every committed recurring obligation.
 * Obligations categorised `goals` are excluded here and counted as goal
 * contributions instead, so nothing is subtracted twice.
 */
export function monthlyFixedCommitments(context: FinancialContext): number {
  return round2(
    context.recurringObligations
      .filter((o) => o.isActive && o.category !== "goals")
      .reduce((sum, o) => sum + toMonthlyAmount(o.amount, o.frequency), 0),
  );
}

/**
 * Planned debt payments that are not already represented as a recurring
 * obligation: manual liabilities plus credit-card payments.
 */
export function monthlyDebtPayments(context: FinancialContext): number {
  const override = context.monthlyPlanOverride?.debtPayment;
  if (override != null) return override;

  const accountsWithObligation = new Set(
    context.recurringObligations
      .filter((o) => o.isActive && o.accountId)
      .map((o) => o.accountId as string),
  );

  const manual = context.manualLiabilities
    .filter((l) => l.isActive)
    .reduce(
      (sum, l) =>
        sum +
        (l.plannedMonthlyPayment > 0
          ? l.plannedMonthlyPayment
          : l.minimumMonthlyPayment),
      0,
    );

  // A credit-card payment settles spending that has already been counted as an
  // expense, so it is NOT added to the monthly plan as new spending — only the
  // minimum, which represents interest-bearing debt service the user has
  // committed to, is treated as a plan-level obligation. Full cash timing is
  // handled by the liquidity guard instead.
  const cardMinimums = context.accounts
    .filter(
      (a) =>
        a.isActive &&
        a.type === "credit" &&
        !accountsWithObligation.has(a.id) &&
        a.paymentStrategy === "minimum_payment",
    )
    .reduce((sum, a) => {
      const liability = context.liabilities.find((l) => l.accountId === a.id);
      return sum + (liability?.minimumPayment ?? 0);
    }, 0);

  return round2(manual + cardMinimums);
}

export function monthlyGoalContributions(context: FinancialContext): number {
  const override = context.monthlyPlanOverride?.goalContribution;
  if (override != null) return override;

  const fromGoals = context.goals
    .filter((g) => g.isActive)
    .reduce((sum, g) => sum + g.desiredMonthlyContribution, 0);

  const fromObligations = context.recurringObligations
    .filter((o) => o.isActive && o.category === "goals")
    .reduce((sum, o) => sum + toMonthlyAmount(o.amount, o.frequency), 0);

  return round2(fromGoals + fromObligations);
}

/** One-time expenses landing this month that are not already funded. */
export function plannedOneTimeThisMonth(context: FinancialContext): number {
  const { start, end } = monthBounds(context.asOf);
  return round2(
    context.plannedExpenses
      .filter(
        (p) =>
          !p.isSettled &&
          !p.isReserved &&
          p.expectedDate >= start &&
          p.expectedDate <= end,
      )
      .reduce((sum, p) => sum + p.amount, 0),
  );
}

/**
 * Builds the monthly plan. Full-month accounting throughout: income is the
 * whole month's expected income and commitments are the whole month's
 * commitments, so the two sides stay comparable regardless of what day it is.
 */
export function buildMonthlyPlan(context: FinancialContext): MonthlyPlan {
  const { start, end } = monthBounds(context.asOf);
  const monthTxns = currentMonthTransactions(context);

  const expectedIncome = expectedMonthlyIncome(context);
  const fixedCommitments = monthlyFixedCommitments(context);

  const necessaryAllowance =
    context.monthlyPlanOverride?.necessaryAllowance ??
    context.profile.necessaryMonthlyAllowance;

  const necessarySpent = spentInBucket(monthTxns, "necessary");
  const necessaryRemaining = round2(Math.max(0, necessaryAllowance - necessarySpent));
  // Money spent past the allowance has to come from somewhere: it reduces fun.
  const necessaryOverage = round2(Math.max(0, necessarySpent - necessaryAllowance));

  const plannedDebtPayments = monthlyDebtPayments(context);
  const goalContributions = monthlyGoalContributions(context);
  const plannedOneTimeExpenses = plannedOneTimeThisMonth(context);

  // If liquid cash currently sits below the buffer, rebuilding it is a real
  // claim on this month's money.
  const buffer = context.monthlyPlanOverride?.buffer ?? context.profile.cashBuffer;
  const bufferContribution = round2(
    Math.max(0, buffer - liquidBalance(context.accounts)),
  );

  const monthlyFunBudget = round2(
    expectedIncome -
      fixedCommitments -
      necessaryAllowance -
      necessaryOverage -
      plannedDebtPayments -
      goalContributions -
      plannedOneTimeExpenses -
      bufferContribution,
  );

  const funSpent = spentInBucket(monthTxns, "fun");

  return {
    monthStart: start,
    monthEnd: end,
    expectedIncome,
    fixedCommitments,
    necessaryAllowance,
    necessarySpent,
    necessaryRemaining,
    necessaryOverage,
    plannedDebtPayments,
    goalContributions,
    plannedOneTimeExpenses,
    bufferContribution,
    monthlyFunBudget,
    funSpent,
    remainingMonthlyFunBudget: round2(monthlyFunBudget - funSpent),
  };
}

function statusFor(amount: number, weeklyPace: number): SafeToSpendStatus {
  if (amount < 0) return "overcommitted";
  if (weeklyPace < 50) return "tight";
  return "on_track";
}

/**
 * Computes the canonical Safe-to-Spend number.
 *
 * `extraEvents` lets the scenario engine inject a hypothetical purchase into
 * the liquidity projection without duplicating any of this logic.
 */
export function computeSafeToSpend(
  context: FinancialContext,
  options: { extraEvents?: CashFlowEvent[]; extraFunSpend?: number } = {},
): SafeToSpendResult {
  const plan = buildMonthlyPlan(context);
  const forecast = buildForecast(context, options.extraEvents ?? []);

  const remainingFun = round2(
    plan.remainingMonthlyFunBudget - (options.extraFunSpend ?? 0),
  );
  const liquidity = forecast.availableLiquidityAboveBuffer;

  const amount = round2(Math.min(remainingFun, liquidity));
  const limitingFactor = remainingFun <= liquidity ? "monthly_plan" : "liquidity";

  const daysLeft = daysRemainingInMonth(context.asOf);
  const weeklyPace = round2(Math.max(0, amount) / Math.max(1, daysLeft / 7));

  const hasData =
    context.accounts.some((a) => a.isActive) ||
    context.incomeSources.length > 0 ||
    context.recurringObligations.length > 0;

  return {
    amount,
    limitingFactor,
    status: statusFor(amount, weeklyPace),
    daysRemainingInMonth: daysLeft,
    weeklyPace,
    plan: {
      ...plan,
      remainingMonthlyFunBudget: remainingFun,
    },
    forecast,
    dataThrough: context.dataThrough,
    hasData,
  };
}

/**
 * The tappable "How this was calculated" breakdown. Every line is a real term
 * from the computation above — nothing here is generated prose.
 */
export interface ExplanationLine {
  label: string;
  amount: number;
  kind: "in" | "out" | "total" | "constraint";
  note?: string;
}

export function explainSafeToSpend(result: SafeToSpendResult): {
  lines: ExplanationLine[];
  limitingFactor: "monthly_plan" | "liquidity";
  explanation: string;
} {
  const p = result.plan;
  const lines: ExplanationLine[] = [
    { label: "Expected monthly income", amount: p.expectedIncome, kind: "in" },
    { label: "Fixed commitments", amount: -p.fixedCommitments, kind: "out" },
    {
      label: "Necessary allowance",
      amount: -p.necessaryAllowance,
      kind: "out",
      note: `${formatShort(p.necessaryRemaining)} of ${formatShort(
        p.necessaryAllowance,
      )} still unspent`,
    },
  ];

  if (p.necessaryOverage > 0) {
    lines.push({
      label: "Necessary spending over allowance",
      amount: -p.necessaryOverage,
      kind: "out",
    });
  }

  lines.push(
    { label: "Debt payments", amount: -p.plannedDebtPayments, kind: "out" },
    { label: "Goal contributions", amount: -p.goalContributions, kind: "out" },
  );

  if (p.plannedOneTimeExpenses > 0) {
    lines.push({
      label: "Planned one-time expenses",
      amount: -p.plannedOneTimeExpenses,
      kind: "out",
    });
  }
  if (p.bufferContribution > 0) {
    lines.push({
      label: "Rebuilding cash buffer",
      amount: -p.bufferContribution,
      kind: "out",
    });
  }

  lines.push(
    { label: "Monthly fun budget", amount: p.monthlyFunBudget, kind: "total" },
    { label: "Fun already spent", amount: -p.funSpent, kind: "out" },
    {
      label: "Remaining monthly fun budget",
      amount: p.remainingMonthlyFunBudget,
      kind: "constraint",
    },
    {
      label: "Available liquidity above buffer",
      amount: result.forecast.availableLiquidityAboveBuffer,
      kind: "constraint",
      note: `Lowest projected cash ${formatShort(
        result.forecast.lowestProjectedBalance,
      )} on ${formatDay(result.forecast.lowestProjectedDate)}, buffer ${formatShort(
        result.forecast.cashBuffer,
      )}`,
    },
    { label: "Safe to spend", amount: result.amount, kind: "total" },
  );

  const explanation =
    result.limitingFactor === "monthly_plan"
      ? "Your monthly plan is the limiting factor. You have cash on hand, but " +
        "spending more than this would eat into money already assigned to " +
        "bills, debt, or goals this month."
      : "Cash-flow timing is the limiting factor. Your monthly plan allows " +
        "more, but between now and your next paycheck the money isn't in " +
        "checking yet — spending more would push you below your cash buffer.";

  return { lines, limitingFactor: result.limitingFactor, explanation };
}

function formatShort(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** "Aug 18" — the explanation is user-facing, so an ISO date won't do. */
function formatDay(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
