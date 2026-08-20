import { describe, expect, it } from "vitest";
import { runExtraDebtPayment, runPurchaseScenario } from "@/lib/finance/scenario";
import { detectRecurringExpenses } from "@/lib/finance/recurrence";
import { explainSafeToSpend, computeSafeToSpend } from "@/lib/finance/safe-to-spend";
import { buildContext, checking, income, obligation, txn, TODAY } from "./helpers";

describe("purchase scenario", () => {
  const comfortable = buildContext({
    accounts: [checking({ currentBalance: 9000, availableBalance: 9000 })],
    incomeSources: [income({ expectedNetAmount: 3000 })],
    recurringObligations: [obligation({ amount: 1500, nextDueDate: "2026-09-01" })],
  });

  it("approves a purchase that fits", () => {
    const result = runPurchaseScenario(comfortable, {
      amount: 450,
      description: "Dress",
    });

    expect(result.verdict).toBe("affordable");
    expect(result.headline).toBe("Yes — affordable");
    expect(result.safeToSpendAfter).toBeCloseTo(result.safeToSpendBefore - 450, 2);
    expect(result.bufferMaintained).toBe(true);
    expect(result.goalsIntact).toBe(true);
    expect(result.earliestComfortableDate).toBeNull();
  });

  it("tells the user to wait when the buffer would break", () => {
    const tight = buildContext({
      accounts: [checking({ currentBalance: 1400, availableBalance: 1400 })],
      incomeSources: [
        income({
          expectedNetAmount: 3000,
          frequency: "monthly",
          nextExpectedDate: "2026-08-16",
        }),
      ],
    });

    const result = runPurchaseScenario(tight, { amount: 900, description: "Flight" });

    expect(result.verdict).toBe("wait");
    expect(result.headline).toBe("Better to wait");
    expect(result.bufferMaintained).toBe(false);
    // It becomes affordable once the paycheck lands.
    expect(result.earliestComfortableDate).toBe("2026-08-16");
    expect(result.reasons.join(" ")).toContain("buffer");
  });

  it("does not consume the fun budget for a necessary purchase", () => {
    const fun = runPurchaseScenario(comfortable, { amount: 300, classification: "fun" });
    const necessary = runPurchaseScenario(comfortable, {
      amount: 300,
      classification: "necessary",
    });

    // Both cost the same cash, but only the discretionary one eats fun money.
    expect(necessary.safeToSpendAfter).toBeGreaterThan(fun.safeToSpendAfter);
  });

  it("uses today when no date is supplied", () => {
    const result = runPurchaseScenario(comfortable, { amount: 100 });
    expect(result.input.date).toBe("2026-08-10");
  });

  it("treats a negative input as its absolute value", () => {
    const result = runPurchaseScenario(comfortable, { amount: -250 });
    expect(result.input.amount).toBe(250);
  });
});

describe("extra debt payment scenario", () => {
  it("reports the liquidity cost of paying extra", () => {
    const context = buildContext({
      accounts: [checking({ currentBalance: 6000, availableBalance: 6000 })],
      incomeSources: [income({ expectedNetAmount: 3000 })],
    });

    const result = runExtraDebtPayment(context, 500);

    expect(result.amount).toBe(500);
    expect(result.lowestProjectedCashAfter).toBeCloseTo(5500, 2);
    expect(result.bufferMaintained).toBe(true);
  });

  it("flags an extra payment that would break the buffer", () => {
    const context = buildContext({
      accounts: [checking({ currentBalance: 1200, availableBalance: 1200 })],
    });
    const result = runExtraDebtPayment(context, 500);
    expect(result.bufferMaintained).toBe(false);
  });
});

describe("explainability", () => {
  it("returns a breakdown whose lines are real terms from the calculation", () => {
    const context = buildContext({
      accounts: [checking({ currentBalance: 5000, availableBalance: 5000 })],
      incomeSources: [income({ expectedNetAmount: 3000, frequency: "monthly" })],
      recurringObligations: [obligation({ amount: 1200 })],
    });

    const result = computeSafeToSpend(context);
    const { lines, explanation } = explainSafeToSpend(result);

    const labels = lines.map((l) => l.label);
    expect(labels).toContain("Expected monthly income");
    expect(labels).toContain("Fixed commitments");
    expect(labels).toContain("Safe to spend");

    const total = lines.find((l) => l.label === "Safe to spend");
    expect(total?.amount).toBe(result.amount);
    expect(explanation.length).toBeGreaterThan(20);
  });

  it("names the limiting factor correctly", () => {
    const liquidityBound = computeSafeToSpend(
      buildContext({
        accounts: [checking({ currentBalance: 1100, availableBalance: 1100 })],
        incomeSources: [
          income({
            expectedNetAmount: 8000,
            frequency: "monthly",
            nextExpectedDate: "2026-09-05",
          }),
        ],
      }),
    );
    expect(liquidityBound.limitingFactor).toBe("liquidity");
    expect(explainSafeToSpend(liquidityBound).explanation).toContain("timing");
  });
});

describe("recurring detection fallback", () => {
  it("finds a monthly subscription from history alone", () => {
    const transactions = ["2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"].map(
      (date) =>
        txn({
          date,
          amount: -215,
          name: "EQUINOX",
          merchantName: "Equinox",
          merchantKey: "equinox",
          classification: "fun",
        }),
    );

    const [candidate] = detectRecurringExpenses(transactions, TODAY);

    expect(candidate.merchantKey).toBe("equinox");
    expect(candidate.frequency).toBe("monthly");
    expect(candidate.averageAmount).toBe(215);
    expect(candidate.occurrenceCount).toBe(4);
    expect(candidate.confidence).toBeGreaterThan(0.8);
  });

  it("ignores merchants with too few occurrences", () => {
    const transactions = ["2026-07-12", "2026-08-12"].map((date) =>
      txn({ date, amount: -215, merchantKey: "equinox" }),
    );
    expect(detectRecurringExpenses(transactions, TODAY)).toHaveLength(0);
  });

  it("ignores irregular one-off spending at the same merchant", () => {
    const transactions = ["2026-05-02", "2026-05-19", "2026-07-28", "2026-08-03"].map(
      (date, i) =>
        txn({
          date,
          amount: -(12 + i * 37),
          merchantKey: "corner bodega",
        }),
    );
    expect(detectRecurringExpenses(transactions, TODAY)).toHaveLength(0);
  });

  it("excludes merchants the user already decided about", () => {
    const transactions = ["2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"].map(
      (date) => txn({ date, amount: -215, merchantKey: "equinox" }),
    );
    const result = detectRecurringExpenses(transactions, TODAY, {
      excludeMerchantKeys: new Set(["equinox"]),
    });
    expect(result).toHaveLength(0);
  });

  it("never proposes a transfer as a recurring bill", () => {
    const transactions = ["2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"].map(
      (date) =>
        txn({ date, amount: -500, merchantKey: "savings transfer", classification: "transfer" }),
    );
    expect(detectRecurringExpenses(transactions, TODAY)).toHaveLength(0);
  });

  it("predicts the next occurrence in the future", () => {
    const transactions = ["2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"].map(
      (date) => txn({ date, amount: -215, merchantKey: "equinox" }),
    );
    const [candidate] = detectRecurringExpenses(transactions, TODAY);
    expect(candidate.nextPredictedDate >= "2026-08-10").toBe(true);
  });
});
