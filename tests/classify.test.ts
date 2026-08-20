import { describe, expect, it } from "vitest";
import {
  classifyTransaction,
  detectInternalTransfers,
  isLikelyRefund,
  merchantKeyFor,
} from "@/lib/finance/classify";
import { obligation, txn } from "./helpers";

const emptyContext = { merchantRules: [], recurringObligations: [] };

describe("merchant key normalization", () => {
  it("strips reference numbers and card noise", () => {
    expect(merchantKeyFor("AMAZON.COM*A1B2C3", "AMZN Mktp US*2H4YT")).toBe("amazon com");
    expect(merchantKeyFor(null, "SQ *BLUE BOTTLE COFFEE 4471")).toBe("sq blue bottle");
    expect(merchantKeyFor("Equinox", null)).toBe("equinox");
  });

  it("returns an empty key for empty input", () => {
    expect(merchantKeyFor(null, null)).toBe("");
  });

  it("is stable across the same merchant with different suffixes", () => {
    expect(merchantKeyFor(null, "WHOLE FOODS MKT 10234")).toBe(
      merchantKeyFor(null, "WHOLE FOODS MKT 99881"),
    );
  });
});

describe("classification precedence", () => {
  it("lets a user merchant rule override Plaid's category", () => {
    const result = classifyTransaction(
      {
        amount: -82,
        accountType: "depository",
        merchantKey: "amazon com",
        plaidCategoryPrimary: "GENERAL_MERCHANDISE",
        plaidCategoryDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      },
      {
        merchantRules: [{ merchantKey: "amazon com", classification: "necessary" }],
        recurringObligations: [],
      },
    );
    expect(result.classification).toBe("necessary");
  });

  it("classifies a detected internal transfer as a transfer", () => {
    const result = classifyTransaction(
      {
        amount: -820,
        accountType: "depository",
        merchantKey: "amex payment",
        isInternalTransfer: true,
        plaidCategoryPrimary: "LOAN_PAYMENTS",
      },
      emptyContext,
    );
    expect(result.classification).toBe("transfer");
  });

  it("treats an inflow on a credit card as a transfer, never income", () => {
    const result = classifyTransaction(
      { amount: 820, accountType: "credit", merchantKey: "payment thank you" },
      emptyContext,
    );
    expect(result.classification).toBe("transfer");
  });

  it("uses a confirmed recurring obligation's category", () => {
    const result = classifyTransaction(
      { amount: -215, accountType: "depository", merchantKey: "equinox" },
      {
        merchantRules: [],
        recurringObligations: [
          obligation({ name: "Equinox", merchantKey: "equinox", category: "fixed" }),
        ],
      },
    );
    expect(result.classification).toBe("fixed");
  });

  it("maps groceries to necessary and restaurants to fun", () => {
    expect(
      classifyTransaction(
        {
          amount: -140,
          accountType: "depository",
          merchantKey: "whole foods",
          plaidCategoryPrimary: "FOOD_AND_DRINK",
          plaidCategoryDetailed: "FOOD_AND_DRINK_GROCERIES",
        },
        emptyContext,
      ).classification,
    ).toBe("necessary");

    expect(
      classifyTransaction(
        {
          amount: -64,
          accountType: "depository",
          merchantKey: "some bistro",
          plaidCategoryPrimary: "FOOD_AND_DRINK",
          plaidCategoryDetailed: "FOOD_AND_DRINK_RESTAURANT",
        },
        emptyContext,
      ).classification,
    ).toBe("fun");
  });

  it("maps rent and utilities to fixed", () => {
    expect(
      classifyTransaction(
        {
          amount: -2800,
          accountType: "depository",
          merchantKey: "property mgmt",
          plaidCategoryPrimary: "RENT_AND_UTILITIES",
          plaidCategoryDetailed: "RENT_AND_UTILITIES_RENT",
        },
        emptyContext,
      ).classification,
    ).toBe("fixed");
  });

  it("maps a credit-card payment category to transfer", () => {
    expect(
      classifyTransaction(
        {
          amount: -820,
          accountType: "depository",
          merchantKey: "amex",
          plaidCategoryPrimary: "LOAN_PAYMENTS",
          plaidCategoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        },
        emptyContext,
      ).classification,
    ).toBe("transfer");
  });

  it("recognises a paycheck as income", () => {
    expect(
      classifyTransaction(
        {
          amount: 3500,
          accountType: "depository",
          merchantKey: "acme payroll",
          plaidCategoryPrimary: "INCOME",
          plaidCategoryDetailed: "INCOME_WAGES",
        },
        emptyContext,
      ).classification,
    ).toBe("income");
  });

  it("does NOT assume an unexplained inflow is income", () => {
    const result = classifyTransaction(
      { amount: 600, accountType: "depository", merchantKey: "unknown sender" },
      emptyContext,
    );
    expect(result.classification).toBe("transfer");
    expect(result.classification).not.toBe("income");
  });

  it("treats an outflow tagged INCOME as a reversal, not negative income", () => {
    expect(
      classifyTransaction(
        {
          amount: -3500,
          accountType: "depository",
          merchantKey: "acme payroll",
          plaidCategoryPrimary: "INCOME",
        },
        emptyContext,
      ).classification,
    ).toBe("ignore");
  });
});

describe("internal transfer pairing", () => {
  it("does not pair transactions on the same account", () => {
    const matched = detectInternalTransfers([
      txn({ accountId: "a", amount: -100, date: "2026-08-01" }),
      txn({ accountId: "a", amount: 100, date: "2026-08-01" }),
    ]);
    expect(matched.size).toBe(0);
  });

  it("does not pair amounts that differ", () => {
    const matched = detectInternalTransfers([
      txn({ accountId: "a", amount: -100, date: "2026-08-01" }),
      txn({ accountId: "b", amount: 105, date: "2026-08-01" }),
    ]);
    expect(matched.size).toBe(0);
  });

  it("does not pair across a long gap", () => {
    const matched = detectInternalTransfers([
      txn({ accountId: "a", amount: -100, date: "2026-08-01" }),
      txn({ accountId: "b", amount: 100, date: "2026-08-20" }),
    ]);
    expect(matched.size).toBe(0);
  });

  it("pairs each leg only once", () => {
    const matched = detectInternalTransfers([
      txn({ id: "out", accountId: "a", amount: -100, date: "2026-08-01" }),
      txn({ id: "in1", accountId: "b", amount: 100, date: "2026-08-01" }),
      txn({ id: "in2", accountId: "c", amount: 100, date: "2026-08-01" }),
    ]);
    expect(matched.size).toBe(2);
  });
});

describe("refund detection", () => {
  it("flags a named refund on a checking account", () => {
    expect(
      isLikelyRefund({
        amount: 450,
        accountType: "depository",
        name: "NORDSTROM REFUND",
      }),
    ).toBe(true);
  });

  it("does not flag a paycheck as a refund", () => {
    expect(
      isLikelyRefund({ amount: 3500, accountType: "depository", name: "ACME PAYROLL" }),
    ).toBe(false);
  });

  it("flags a credit-card credit that is not a payment", () => {
    expect(
      isLikelyRefund({ amount: 82, accountType: "credit", name: "AMAZON RETURN" }),
    ).toBe(true);
  });

  it("does not flag a card payment as a refund", () => {
    expect(
      isLikelyRefund({ amount: 820, accountType: "credit", name: "PAYMENT THANK YOU" }),
    ).toBe(false);
  });

  it("never flags an outflow", () => {
    expect(
      isLikelyRefund({ amount: -50, accountType: "depository", name: "REFUND" }),
    ).toBe(false);
  });
});
