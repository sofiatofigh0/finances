import { earliestAffordableDate, round2 } from "./cashflow";
import { computeAllGoalProgress, goalsIntact } from "./goals";
import { computeSafeToSpend } from "./safe-to-spend";
import { toISODate } from "./dates";
import type {
  CashFlowEvent,
  FinancialContext,
  ObligationCategory,
  SafeToSpendResult,
} from "./types";

/**
 * The "Can I afford this?" engine.
 *
 * Everything here is deterministic. The agent may narrate the result but the
 * verdict and every number in it come from this function.
 */

export interface PurchaseScenarioInput {
  amount: number;
  /** ISO date; defaults to today. */
  date?: string;
  description?: string;
  /** Which bucket the purchase lands in. Defaults to discretionary. */
  classification?: ObligationCategory;
}

export type Verdict = "affordable" | "tight" | "wait";

export interface PurchaseScenarioResult {
  input: {
    amount: number;
    date: string;
    description: string | null;
    classification: ObligationCategory;
  };
  verdict: Verdict;
  headline: string;
  safeToSpendBefore: number;
  safeToSpendAfter: number;
  limitingFactorAfter: "monthly_plan" | "liquidity";
  weeklyPaceAfter: number;
  lowestProjectedCashAfter: number;
  lowestProjectedDateAfter: string;
  cashBuffer: number;
  bufferMaintained: boolean;
  upcomingObligationsCovered: boolean;
  goalsIntact: boolean;
  /** Set when the purchase should wait: the first date it fits comfortably. */
  earliestComfortableDate: string | null;
  reasons: string[];
}

export function runPurchaseScenario(
  context: FinancialContext,
  input: PurchaseScenarioInput,
): PurchaseScenarioResult {
  const amount = Math.abs(input.amount);
  const date = input.date ?? toISODate(context.asOf);
  const classification: ObligationCategory = input.classification ?? "fun";

  const before: SafeToSpendResult = computeSafeToSpend(context);

  const hypothetical: CashFlowEvent = {
    date,
    label: input.description || "Planned purchase",
    amount: -amount,
    kind: "planned_expense",
    sourceId: "scenario",
  };

  const after = computeSafeToSpend(context, {
    extraEvents: [hypothetical],
    // Only discretionary purchases consume the fun budget; a necessary or
    // fixed purchase still consumes cash but is accounted for elsewhere.
    extraFunSpend: classification === "fun" ? amount : 0,
  });

  const bufferMaintained =
    after.forecast.lowestProjectedBalance >= context.profile.cashBuffer;

  // "Obligations covered" means projected cash never goes negative, i.e. every
  // known bill in the horizon can actually clear.
  const upcomingObligationsCovered = after.forecast.lowestProjectedBalance >= 0;

  const goalProgress = computeAllGoalProgress(context.goals, context.asOf);
  const goalsAreIntact = goalsIntact(goalProgress);

  let verdict: Verdict;
  if (!bufferMaintained || after.amount < 0) {
    verdict = "wait";
  } else if (after.amount < after.weeklyPace) {
    verdict = "tight";
  } else {
    verdict = "affordable";
  }

  const earliestComfortableDate =
    verdict === "wait" ? earliestAffordableDate(context, amount) : null;

  const reasons: string[] = [];
  if (!bufferMaintained) {
    reasons.push(
      `This would pull your projected cash down to ${money(
        after.forecast.lowestProjectedBalance,
      )} on ${after.forecast.lowestProjectedDate}, below your ${money(
        context.profile.cashBuffer,
      )} buffer.`,
    );
  }
  if (after.amount < 0 && bufferMaintained) {
    reasons.push(
      `This is ${money(Math.abs(after.amount))} more than your plan has left for fun this month.`,
    );
  }
  if (verdict === "affordable") {
    reasons.push(
      `Your obligations, cash buffer, and goal contributions all stay intact.`,
    );
  }
  if (verdict === "tight") {
    reasons.push(
      `It fits, but it leaves ${money(after.amount)} for the rest of the month — under your usual ${money(
        after.weeklyPace,
      )} weekly pace.`,
    );
  }

  return {
    input: {
      amount,
      date,
      description: input.description ?? null,
      classification,
    },
    verdict,
    headline:
      verdict === "affordable"
        ? "Yes — affordable"
        : verdict === "tight"
          ? "Affordable, but tight"
          : "Better to wait",
    safeToSpendBefore: before.amount,
    safeToSpendAfter: after.amount,
    limitingFactorAfter: after.limitingFactor,
    weeklyPaceAfter: after.weeklyPace,
    lowestProjectedCashAfter: after.forecast.lowestProjectedBalance,
    lowestProjectedDateAfter: after.forecast.lowestProjectedDate,
    cashBuffer: context.profile.cashBuffer,
    bufferMaintained,
    upcomingObligationsCovered,
    goalsIntact: goalsAreIntact,
    earliestComfortableDate,
    reasons,
  };
}

/** Simulates an extra payment toward a debt and reports the liquidity impact. */
export interface ExtraDebtPaymentResult {
  amount: number;
  safeToSpendBefore: number;
  safeToSpendAfter: number;
  bufferMaintained: boolean;
  lowestProjectedCashAfter: number;
  affordable: boolean;
}

export function runExtraDebtPayment(
  context: FinancialContext,
  amount: number,
  date?: string,
): ExtraDebtPaymentResult {
  const when = date ?? toISODate(context.asOf);
  const before = computeSafeToSpend(context);
  const after = computeSafeToSpend(context, {
    extraEvents: [
      {
        date: when,
        label: "Extra debt payment",
        amount: -Math.abs(amount),
        kind: "loan_payment",
        sourceId: "scenario",
      },
    ],
  });

  return {
    amount: round2(Math.abs(amount)),
    safeToSpendBefore: before.amount,
    safeToSpendAfter: after.amount,
    bufferMaintained:
      after.forecast.lowestProjectedBalance >= context.profile.cashBuffer,
    lowestProjectedCashAfter: after.forecast.lowestProjectedBalance,
    affordable: after.amount >= 0,
  };
}

function money(value: number): string {
  return `$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
}
