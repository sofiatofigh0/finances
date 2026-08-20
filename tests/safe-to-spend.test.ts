import { describe, expect, it } from "vitest";
import {
  buildMonthlyPlan,
  computeSafeToSpend,
  currentMonthTransactions,
  spentInBucket,
} from "@/lib/finance/safe-to-spend";
import { buildForecast, cardPaymentAmount } from "@/lib/finance/cashflow";
import {
  detectInternalTransfers,
  dedupePendingPosted,
} from "@/lib/finance/classify";
import {
  buildContext,
  checking,
  creditCard,
  goal,
  income,
  liabilityDetail,
  obligation,
  savings,
  txn,
  TODAY,
} from "./helpers";

/**
 * These tests are the safety net for the number the whole product exists to
 * produce. They cover the cases where a naive implementation would be
 * confidently wrong.
 */

describe("Case 1 — a normal month", () => {
  it("derives fun money from income minus every commitment", () => {
    const acct = checking({ currentBalance: 5000, availableBalance: 5000 });
    const context = buildContext({
      accounts: [acct],
      incomeSources: [income({ expectedNetAmount: 2500, frequency: "biweekly" })],
      recurringObligations: [
        obligation({ name: "Rent", amount: 2800 }),
        obligation({ name: "Gym", amount: 215, nextDueDate: "2026-08-20" }),
      ],
      goals: [goal({ desiredMonthlyContribution: 400 })],
      transactions: [
        txn({ accountId: acct.id, amount: -120, classification: "fun" }),
        txn({ accountId: acct.id, amount: -200, classification: "necessary" }),
      ],
    });

    const plan = buildMonthlyPlan(context);

    // 2500 biweekly => 26/12 pay periods per month.
    expect(plan.expectedIncome).toBeCloseTo(2500 * (26 / 12), 2);
    expect(plan.fixedCommitments).toBe(3015);
    expect(plan.necessaryAllowance).toBe(600);
    expect(plan.goalContributions).toBe(400);
    expect(plan.funSpent).toBe(120);

    const expectedBudget =
      plan.expectedIncome - 3015 - 600 - 0 - 0 - 400 - 0 - plan.bufferContribution;
    expect(plan.monthlyFunBudget).toBeCloseTo(expectedBudget, 2);
    expect(plan.remainingMonthlyFunBudget).toBeCloseTo(expectedBudget - 120, 2);
  });

  it("produces a positive Safe-to-Spend with a weekly pace", () => {
    const acct = checking({ currentBalance: 6000, availableBalance: 6000 });
    const result = computeSafeToSpend(
      buildContext({
        accounts: [acct],
        incomeSources: [income()],
        recurringObligations: [obligation({ amount: 1200 })],
      }),
    );

    expect(result.amount).toBeGreaterThan(0);
    expect(result.weeklyPace).toBeGreaterThan(0);
    expect(["monthly_plan", "liquidity"]).toContain(result.limitingFactor);
  });
});

describe("Case 2 — credit-card purchases vs. card payments", () => {
  it("counts a card purchase as spending", () => {
    const card = creditCard();
    const context = buildContext({
      accounts: [card],
      transactions: [
        txn({ accountId: card.id, amount: -250, classification: "fun" }),
      ],
    });
    expect(spentInBucket(currentMonthTransactions(context), "fun")).toBe(250);
  });

  it("does NOT count the later payment as a second expense", () => {
    const acct = checking();
    const card = creditCard();
    const transactions = [
      // The purchase on the card — real spending.
      txn({ accountId: card.id, amount: -250, classification: "fun", date: "2026-08-03" }),
      // Cash leaving checking to pay the card.
      txn({
        accountId: acct.id,
        amount: -250,
        date: "2026-08-09",
        name: "Card Payment",
        classification: "transfer",
      }),
      // The matching credit landing on the card.
      txn({
        accountId: card.id,
        amount: 250,
        date: "2026-08-09",
        name: "Payment Thank You",
        classification: "transfer",
      }),
    ];

    const context = buildContext({ accounts: [acct, card], transactions });
    const month = currentMonthTransactions(context);

    // Total fun spending is still 250, not 500.
    expect(spentInBucket(month, "fun")).toBe(250);
    // And the payment legs are not income.
    expect(spentInBucket(month, "income")).toBe(0);
  });

  it("pairs the two legs of a card payment as an internal transfer", () => {
    const acct = checking();
    const card = creditCard();
    const transactions = [
      txn({ accountId: acct.id, amount: -820, date: "2026-08-18", name: "Amex Payment" }),
      txn({ accountId: card.id, amount: 820, date: "2026-08-18", name: "Payment Received" }),
    ];
    const matched = detectInternalTransfers(transactions);
    expect(matched.size).toBe(2);
  });

  it("still reserves cash for the upcoming card payment", () => {
    const acct = checking({ currentBalance: 2000, availableBalance: 2000 });
    const card = creditCard({ currentBalance: 800 });
    const context = buildContext({
      accounts: [acct, card],
      liabilities: [liabilityDetail({ accountId: card.id, lastStatementBalance: 800 })],
    });

    const forecast = buildForecast(context);
    const payment = forecast.events.find((e) => e.kind === "card_payment");

    expect(payment).toBeDefined();
    expect(payment?.amount).toBe(-800);
    // Cash dips even though no new expense was incurred.
    expect(forecast.lowestProjectedBalance).toBeLessThan(2000);
  });
});

describe("Case 3 — checking to savings is not income or spending", () => {
  it("classifies both legs as transfer and leaves buckets untouched", () => {
    const acct = checking();
    const save = savings();
    const context = buildContext({
      accounts: [acct, save],
      transactions: [
        txn({ accountId: acct.id, amount: -500, date: "2026-08-04", classification: "transfer" }),
        txn({ accountId: save.id, amount: 500, date: "2026-08-04", classification: "transfer" }),
      ],
    });

    const month = currentMonthTransactions(context);
    expect(spentInBucket(month, "fun")).toBe(0);
    expect(spentInBucket(month, "necessary")).toBe(0);
    expect(spentInBucket(month, "income")).toBe(0);
  });
});

describe("Case 4 — a large purchase lowers Safe-to-Spend", () => {
  it("reduces the number by roughly the purchase amount", () => {
    const acct = checking({ currentBalance: 9000, availableBalance: 9000 });
    const base = buildContext({
      accounts: [acct],
      incomeSources: [income({ expectedNetAmount: 3000 })],
      recurringObligations: [obligation({ amount: 1500 })],
    });

    const before = computeSafeToSpend(base);
    const after = computeSafeToSpend({
      ...base,
      transactions: [txn({ accountId: acct.id, amount: -900, classification: "fun" })],
    });

    expect(after.amount).toBeLessThan(before.amount);
    expect(before.amount - after.amount).toBeCloseTo(900, 2);
  });
});

describe("Case 5 — liquidity is tighter than the monthly plan", () => {
  it("lets the cash-flow constraint win", () => {
    // Plenty of budget on paper, almost no cash in checking right now.
    const acct = checking({ currentBalance: 1200, availableBalance: 1200 });
    const context = buildContext({
      accounts: [acct],
      incomeSources: [
        // Paycheck lands after the forecast dip.
        income({ expectedNetAmount: 6000, frequency: "monthly", nextExpectedDate: "2026-09-05" }),
      ],
      recurringObligations: [
        obligation({ name: "Rent", amount: 900, nextDueDate: "2026-08-20" }),
      ],
    });

    const result = computeSafeToSpend(context);

    expect(result.limitingFactor).toBe("liquidity");
    expect(result.amount).toBe(result.forecast.availableLiquidityAboveBuffer);
    expect(result.amount).toBeLessThan(result.plan.remainingMonthlyFunBudget);
  });
});

describe("Case 6 — a paycheck before rent prevents a false shortfall", () => {
  it("does not report a dip when income lands first", () => {
    const acct = checking({ currentBalance: 1500, availableBalance: 1500 });
    const context = buildContext({
      accounts: [acct],
      incomeSources: [
        income({ expectedNetAmount: 3500, frequency: "monthly", nextExpectedDate: "2026-08-15" }),
      ],
      recurringObligations: [
        obligation({ name: "Rent", amount: 2800, nextDueDate: "2026-08-18" }),
      ],
    });

    const forecast = buildForecast(context);
    // 1500 + 3500 - 2800 = 2200 after both events; never below 1500 before them.
    expect(forecast.lowestProjectedBalance).toBeGreaterThanOrEqual(1500);
    expect(forecast.availableLiquidityAboveBuffer).toBeGreaterThan(0);
  });

  it("DOES report a dip when rent lands before the paycheck", () => {
    const acct = checking({ currentBalance: 1500, availableBalance: 1500 });
    const context = buildContext({
      accounts: [acct],
      incomeSources: [
        income({ expectedNetAmount: 3500, frequency: "monthly", nextExpectedDate: "2026-08-20" }),
      ],
      recurringObligations: [
        obligation({ name: "Rent", amount: 2800, nextDueDate: "2026-08-15" }),
      ],
    });

    const forecast = buildForecast(context);
    expect(forecast.lowestProjectedBalance).toBeCloseTo(-1300, 2);
    expect(forecast.lowestProjectedDate).toBe("2026-08-15");
  });

  it("nets a paycheck and rent that land on the same day", () => {
    const acct = checking({ currentBalance: 1500, availableBalance: 1500 });
    const context = buildContext({
      accounts: [acct],
      incomeSources: [
        income({ expectedNetAmount: 3500, frequency: "monthly", nextExpectedDate: "2026-08-15" }),
      ],
      recurringObligations: [
        obligation({ name: "Rent", amount: 2800, nextDueDate: "2026-08-15" }),
      ],
    });

    const forecast = buildForecast(context);
    expect(forecast.lowestProjectedBalance).toBeCloseTo(1500, 2);
  });
});

describe("Case 7 — changing a card payment strategy", () => {
  it("reserves the statement balance by default", () => {
    const card = creditCard({ currentBalance: 3000, paymentStrategy: "statement_balance" });
    const liability = liabilityDetail({
      accountId: card.id,
      lastStatementBalance: 2400,
      minimumPayment: 60,
    });
    expect(cardPaymentAmount(card, liability)).toBe(2400);
  });

  it("reserves only the minimum once the user switches strategy", () => {
    const card = creditCard({ currentBalance: 3000, paymentStrategy: "minimum_payment" });
    const liability = liabilityDetail({
      accountId: card.id,
      lastStatementBalance: 2400,
      minimumPayment: 60,
    });
    expect(cardPaymentAmount(card, liability)).toBe(60);
  });

  it("frees up Safe-to-Spend when switching statement -> minimum", () => {
    const acct = checking({ currentBalance: 4000, availableBalance: 4000 });
    const statementCard = creditCard({
      currentBalance: 3000,
      paymentStrategy: "statement_balance",
    });
    const base = buildContext({
      accounts: [acct, statementCard],
      liabilities: [
        liabilityDetail({
          accountId: statementCard.id,
          lastStatementBalance: 2400,
          minimumPayment: 60,
        }),
      ],
      // Paycheck lands after the card is due, so the payment actually bites.
      incomeSources: [
        income({
          expectedNetAmount: 4000,
          frequency: "monthly",
          nextExpectedDate: "2026-09-05",
        }),
      ],
    });

    const onStatement = computeSafeToSpend(base);
    const onMinimum = computeSafeToSpend({
      ...base,
      accounts: [acct, { ...statementCard, paymentStrategy: "minimum_payment" }],
    });

    expect(onMinimum.forecast.availableLiquidityAboveBuffer).toBeGreaterThan(
      onStatement.forecast.availableLiquidityAboveBuffer,
    );
  });

  it("honours a fixed planned payment", () => {
    const card = creditCard({
      currentBalance: 3000,
      paymentStrategy: "fixed_amount",
      paymentFixedAmount: 500,
    });
    expect(cardPaymentAmount(card, liabilityDetail({ accountId: card.id }))).toBe(500);
  });
});

describe("Case 8 — pending and posted must not double-count", () => {
  it("drops the pending row once its posted twin arrives", () => {
    const acct = checking();
    const transactions = [
      txn({
        accountId: acct.id,
        amount: -82,
        pending: true,
        plaidTransactionId: "pending-1",
        classification: "fun",
      }),
      txn({
        accountId: acct.id,
        amount: -82,
        pending: false,
        plaidTransactionId: "posted-1",
        pendingTransactionId: "pending-1",
        classification: "fun",
      }),
    ];

    const deduped = dedupePendingPosted(transactions);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].plaidTransactionId).toBe("posted-1");

    const context = buildContext({ accounts: [acct], transactions });
    expect(spentInBucket(currentMonthTransactions(context), "fun")).toBe(82);
  });

  it("keeps a pending transaction that has not posted yet", () => {
    const acct = checking();
    const transactions = [
      txn({
        accountId: acct.id,
        amount: -40,
        pending: true,
        plaidTransactionId: "pending-only",
        classification: "fun",
      }),
    ];
    expect(dedupePendingPosted(transactions)).toHaveLength(1);
    const context = buildContext({ accounts: [acct], transactions });
    expect(spentInBucket(currentMonthTransactions(context), "fun")).toBe(40);
  });
});

describe("Case 9 — refunds offset the spending they reverse", () => {
  it("nets a refund against fun spending", () => {
    const acct = checking();
    const context = buildContext({
      accounts: [acct],
      transactions: [
        txn({ accountId: acct.id, amount: -450, date: "2026-08-02", classification: "fun" }),
        txn({
          accountId: acct.id,
          amount: 450,
          date: "2026-08-09",
          name: "Refund",
          classification: "fun",
          isRefund: true,
        }),
      ],
    });

    const month = currentMonthTransactions(context);
    expect(spentInBucket(month, "fun")).toBe(0);
    // Critically, the refund is NOT counted as income.
    expect(spentInBucket(month, "income")).toBe(0);
  });

  it("restores Safe-to-Spend after a return", () => {
    const acct = checking({ currentBalance: 8000, availableBalance: 8000 });
    const base = buildContext({
      accounts: [acct],
      incomeSources: [income({ expectedNetAmount: 4000, frequency: "monthly" })],
    });

    const purchase = txn({
      accountId: acct.id,
      amount: -450,
      date: "2026-08-02",
      classification: "fun",
    });
    const refund = txn({
      accountId: acct.id,
      amount: 450,
      date: "2026-08-09",
      classification: "fun",
      isRefund: true,
    });

    const clean = computeSafeToSpend(base);
    const afterPurchase = computeSafeToSpend({ ...base, transactions: [purchase] });
    const afterRefund = computeSafeToSpend({ ...base, transactions: [purchase, refund] });

    expect(afterPurchase.amount).toBeCloseTo(clean.amount - 450, 2);
    expect(afterRefund.amount).toBeCloseTo(clean.amount, 2);
  });
});

describe("Case 11 — multiple checking accounts combine", () => {
  it("sums liquid balances and ignores non-liquid ones", () => {
    const a = checking({ currentBalance: 1200, availableBalance: 1200 });
    const b = checking({ name: "Bills Checking", currentBalance: 800, availableBalance: 800 });
    const s = savings({ currentBalance: 9000, availableBalance: 9000 });

    const forecast = buildForecast(buildContext({ accounts: [a, b, s] }));
    expect(forecast.startingLiquidBalance).toBe(2000);
  });

  it("counts savings once the user marks it liquid", () => {
    const a = checking({ currentBalance: 1200, availableBalance: 1200 });
    const s = savings({ currentBalance: 9000, availableBalance: 9000, isLiquid: true });
    const forecast = buildForecast(buildContext({ accounts: [a, s] }));
    expect(forecast.startingLiquidBalance).toBe(10200);
  });
});

describe("Case 12 — checking to savings affects liquidity, not fun money", () => {
  it("reduces projected cash without touching the fun budget", () => {
    const acct = checking({ currentBalance: 3000, availableBalance: 3000 });
    const save = savings({ currentBalance: 5000, availableBalance: 5000 });

    const base = buildContext({
      accounts: [acct, save],
      incomeSources: [income({ expectedNetAmount: 4000, frequency: "monthly" })],
      goals: [
        goal({
          desiredMonthlyContribution: 500,
          contributionsLeaveChecking: true,
        }),
      ],
    });

    const result = computeSafeToSpend(base);

    // The transfer shows up as a scheduled cash outflow...
    const goalEvent = result.forecast.events.find((e) => e.kind === "goal_contribution");
    expect(goalEvent?.amount).toBe(-500);

    // ...and as a goal contribution in the plan — but never as fun spending.
    expect(result.plan.goalContributions).toBe(500);
    expect(result.plan.funSpent).toBe(0);
  });

  it("leaves liquidity untouched when the goal does not move cash", () => {
    const acct = checking({ currentBalance: 3000, availableBalance: 3000 });
    const context = buildContext({
      accounts: [acct],
      goals: [goal({ desiredMonthlyContribution: 500, contributionsLeaveChecking: false })],
    });

    const forecast = buildForecast(context);
    expect(forecast.events.some((e) => e.kind === "goal_contribution")).toBe(false);
    expect(forecast.lowestProjectedBalance).toBe(3000);
  });
});

describe("Negative results are surfaced, not hidden", () => {
  it("reports an overage when commitments exceed income", () => {
    const acct = checking({ currentBalance: 500, availableBalance: 500 });
    const result = computeSafeToSpend(
      buildContext({
        accounts: [acct],
        incomeSources: [income({ expectedNetAmount: 1000, frequency: "monthly" })],
        recurringObligations: [obligation({ amount: 2800 })],
      }),
    );

    expect(result.amount).toBeLessThan(0);
    expect(result.status).toBe("overcommitted");
  });
});

describe("Forecast horizon", () => {
  it("respects the configured number of days", () => {
    const context = buildContext({
      accounts: [checking()],
      profile: {
        cashBuffer: 1000,
        necessaryMonthlyAllowance: 600,
        forecastDays: 14,
        currency: "USD",
      },
    });
    const forecast = buildForecast(context);
    expect(forecast.dailyBalances).toHaveLength(15);
    expect(forecast.startDate).toBe("2026-08-10");
    expect(forecast.endDate).toBe("2026-08-24");
  });

  it("uses the fixed test clock", () => {
    expect(TODAY.getFullYear()).toBe(2026);
  });
});
