import { addDays } from "date-fns";
import {
  fromISODate,
  nextDayOfMonth,
  occurrencesBetween,
  toISODate,
} from "./dates";
import type {
  Account,
  CashFlowEvent,
  CashFlowForecast,
  FinancialContext,
  LiabilityDetail,
} from "./types";

/**
 * The liquidity guard.
 *
 * Expense accounting answers "what did I spend?". This answers a different
 * question: "what cash will actually leave checking, and when?" A credit-card
 * purchase is spending but moves no cash today; the payment that settles it
 * moves cash but is not new spending. Both facts have to be modelled or the
 * Safe-to-Spend number is wrong in one direction or the other.
 */

/** Liquid cash available right now across checking-style accounts. */
export function liquidBalance(accounts: Account[]): number {
  return accounts
    .filter((a) => a.isActive && a.isLiquid && a.type === "depository")
    .reduce((sum, a) => {
      // Available balance already excludes holds, so prefer it when present.
      const balance = a.availableBalance ?? a.currentBalance ?? 0;
      return sum + balance;
    }, 0);
}

/** Total debt across Plaid credit/loan accounts and manual liabilities. */
export function totalDebt(context: FinancialContext): number {
  const fromAccounts = context.accounts
    .filter((a) => a.isActive && (a.type === "credit" || a.type === "loan"))
    .reduce((sum, a) => sum + Math.max(0, a.currentBalance ?? 0), 0);
  const fromManual = context.manualLiabilities
    .filter((l) => l.isActive)
    .reduce((sum, l) => sum + Math.max(0, l.currentBalance), 0);
  return fromAccounts + fromManual;
}

/**
 * How much cash to reserve for a credit card, per the user's chosen strategy.
 *
 * The default is the statement balance where reliable data exists, but the
 * setting is always visible: assuming the full balance will be paid when the
 * user actually pays the minimum would understate Safe-to-Spend badly.
 */
export function cardPaymentAmount(
  account: Account,
  liability: LiabilityDetail | undefined,
): number {
  const currentBalance = Math.max(0, account.currentBalance ?? 0);

  switch (account.paymentStrategy) {
    case "minimum_payment":
      return Math.max(0, liability?.minimumPayment ?? currentBalance * 0.02);
    case "fixed_amount":
      return Math.max(0, account.paymentFixedAmount ?? 0);
    case "full_balance":
      return currentBalance;
    case "statement_balance":
    default: {
      const statement = liability?.lastStatementBalance;
      if (statement != null && statement > 0) return statement;
      // No statement data yet — fall back to the current balance rather than
      // silently reserving nothing.
      return currentBalance;
    }
  }
}

/**
 * Builds the list of known cash movements over the forecast horizon.
 * Every event is dated and signed (negative leaves checking).
 */
export function buildCashFlowEvents(
  context: FinancialContext,
  from: Date,
  to: Date,
): CashFlowEvent[] {
  const events: CashFlowEvent[] = [];

  // --- Expected income -----------------------------------------------------
  for (const income of context.incomeSources) {
    if (!income.isActive || !income.nextExpectedDate) continue;
    for (const date of occurrencesBetween(
      income.nextExpectedDate,
      income.frequency,
      from,
      to,
    )) {
      events.push({
        date,
        label: income.name,
        amount: income.expectedNetAmount,
        kind: "income",
        sourceId: income.id,
      });
    }
  }

  // --- Recurring bills -----------------------------------------------------
  // Track which accounts already have an explicit obligation so we do not also
  // auto-generate a card payment for them below.
  const accountsWithExplicitObligation = new Set<string>();

  for (const obligation of context.recurringObligations) {
    if (!obligation.isActive) continue;
    if (obligation.accountId) accountsWithExplicitObligation.add(obligation.accountId);

    for (const date of occurrencesBetween(
      obligation.nextDueDate,
      obligation.frequency,
      from,
      to,
    )) {
      events.push({
        date,
        label: obligation.name,
        amount: -Math.abs(obligation.amount),
        kind: "recurring",
        sourceId: obligation.id,
      });
    }
  }

  // --- Credit-card payments ------------------------------------------------
  const liabilityByAccount = new Map(
    context.liabilities.map((l) => [l.accountId, l]),
  );

  for (const account of context.accounts) {
    if (!account.isActive || account.type !== "credit") continue;
    if (accountsWithExplicitObligation.has(account.id)) continue;

    const liability = liabilityByAccount.get(account.id);
    const amount = cardPaymentAmount(account, liability);
    if (amount <= 0) continue;

    // Use the real due date when Plaid provides one; otherwise assume a
    // monthly cadence anchored on today's day-of-month.
    const anchor =
      liability?.nextPaymentDueDate ?? nextDayOfMonth(from.getDate(), from);

    for (const date of occurrencesBetween(anchor, "monthly", from, to)) {
      events.push({
        date,
        label: `${account.name} payment`,
        amount: -amount,
        kind: "card_payment",
        sourceId: account.id,
      });
    }
  }

  // --- Manual liabilities --------------------------------------------------
  for (const liability of context.manualLiabilities) {
    if (!liability.isActive) continue;
    const payment =
      liability.plannedMonthlyPayment > 0
        ? liability.plannedMonthlyPayment
        : liability.minimumMonthlyPayment;
    if (payment <= 0) continue;

    const anchor = nextDayOfMonth(liability.paymentDueDay ?? 1, from);
    for (const date of occurrencesBetween(anchor, "monthly", from, to)) {
      events.push({
        date,
        label: `${liability.name} payment`,
        amount: -payment,
        kind: "loan_payment",
        sourceId: liability.id,
      });
    }
  }

  // --- One-time planned expenses ------------------------------------------
  for (const planned of context.plannedExpenses) {
    if (planned.isSettled) continue;
    const date = fromISODate(planned.expectedDate);
    if (date < from || date > to) continue;
    events.push({
      date: planned.expectedDate,
      label: planned.name,
      amount: -Math.abs(planned.amount),
      kind: "planned_expense",
      sourceId: planned.id,
    });
  }

  // --- Goal contributions that actually move cash --------------------------
  for (const goal of context.goals) {
    if (!goal.isActive) continue;
    if (!goal.contributionsLeaveChecking) continue;
    if (goal.desiredMonthlyContribution <= 0) continue;

    const anchor = nextDayOfMonth(1, from);
    for (const date of occurrencesBetween(anchor, "monthly", from, to)) {
      events.push({
        date,
        label: `${goal.name} contribution`,
        amount: -goal.desiredMonthlyContribution,
        kind: "goal_contribution",
        sourceId: goal.id,
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Projects liquid cash forward and finds the lowest point.
 *
 * Balances are evaluated at END of day, so a paycheck and rent landing on the
 * same date net out rather than producing a phantom shortfall.
 */
export function buildForecast(
  context: FinancialContext,
  extraEvents: CashFlowEvent[] = [],
): CashFlowForecast {
  const from = context.asOf;
  const to = addDays(from, context.profile.forecastDays);
  const startingLiquidBalance = liquidBalance(context.accounts);

  const events = [...buildCashFlowEvents(context, from, to), ...extraEvents].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  const netByDate = new Map<string, number>();
  for (const event of events) {
    netByDate.set(event.date, (netByDate.get(event.date) ?? 0) + event.amount);
  }

  const dailyBalances: { date: string; balance: number }[] = [];
  let balance = startingLiquidBalance;
  let lowestProjectedBalance = startingLiquidBalance;
  let lowestProjectedDate = toISODate(from);

  for (let day = 0; day <= context.profile.forecastDays; day += 1) {
    const date = toISODate(addDays(from, day));
    balance += netByDate.get(date) ?? 0;
    dailyBalances.push({ date, balance: round2(balance) });
    if (balance < lowestProjectedBalance) {
      lowestProjectedBalance = balance;
      lowestProjectedDate = date;
    }
  }

  return {
    startDate: toISODate(from),
    endDate: toISODate(to),
    startingLiquidBalance: round2(startingLiquidBalance),
    events,
    dailyBalances,
    lowestProjectedBalance: round2(lowestProjectedBalance),
    lowestProjectedDate,
    cashBuffer: context.profile.cashBuffer,
    availableLiquidityAboveBuffer: round2(
      lowestProjectedBalance - context.profile.cashBuffer,
    ),
  };
}

/** The earliest date on which the forecast can absorb `amount` without
 * dipping below the cash buffer. Returns null if it never can inside the
 * horizon. */
export function earliestAffordableDate(
  context: FinancialContext,
  amount: number,
): string | null {
  const base = buildForecast(context);

  for (const point of base.dailyBalances) {
    // Spending on `date` reduces every balance from that day forward.
    const worstAfter = base.dailyBalances
      .filter((p) => p.date >= point.date)
      .reduce((min, p) => Math.min(min, p.balance), Number.POSITIVE_INFINITY);

    if (worstAfter - amount >= context.profile.cashBuffer) {
      return point.date;
    }
  }
  return null;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
