import type {
  Account,
  Classification,
  RecurringObligation,
  Transaction,
} from "./types";

/**
 * Transaction normalization and classification.
 *
 * The product deliberately has ONE opinionated top-level bucket per
 * transaction. Plaid's detailed taxonomy is preserved separately and never
 * overwritten — it feeds the subcategory label and the automatic guess, but the
 * user's choice always wins.
 */

export interface MerchantRule {
  merchantKey: string;
  classification: Classification;
  subcategory?: string | null;
}

/**
 * Normalizes a merchant string into a stable key for rules and recurrence
 * detection: lowercase, punctuation stripped, trailing store/reference numbers
 * removed ("AMAZON.COM*A1B2C3 AMZN.COM/BILL" -> "amazon com").
 */
export function merchantKeyFor(
  merchantName?: string | null,
  transactionName?: string | null,
): string {
  const raw = (merchantName || transactionName || "").toLowerCase();
  if (!raw) return "";

  return raw
    // Card-network noise and reference numbers.
    .replace(/\b(pos|ach|debit|credit|purchase|payment|recurring|pmt)\b/g, " ")
    // Strip `*`/`#` reference codes (AMAZON.COM*A1B2C3) but keep real words
    // that happen to follow a separator (SQ *BLUE BOTTLE).
    .replace(/[#*]\s*(?=[a-z0-9-]*\d)[a-z0-9-]{3,}/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\bx{2,}\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

/**
 * Plaid Personal Finance Category -> our bucket.
 * Keyed on the DETAILED category first, then falling back to PRIMARY.
 */
const DETAILED_MAP: Record<string, Classification> = {
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "transfer",
  TRANSFER_OUT_ACCOUNT_TRANSFER: "transfer",
  TRANSFER_IN_ACCOUNT_TRANSFER: "transfer",
  TRANSFER_IN_DEPOSIT: "income",
  TRANSFER_OUT_SAVINGS: "goals",
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: "transfer",
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: "goals",
  FOOD_AND_DRINK_GROCERIES: "necessary",
  FOOD_AND_DRINK_RESTAURANT: "fun",
  FOOD_AND_DRINK_FAST_FOOD: "fun",
  FOOD_AND_DRINK_COFFEE: "fun",
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "fun",
  FOOD_AND_DRINK_VENDING_MACHINES: "fun",
  GENERAL_MERCHANDISE_CONVENIENCE_STORES: "necessary",
  GENERAL_MERCHANDISE_DISCOUNT_STORES: "necessary",
  GENERAL_MERCHANDISE_SUPERSTORES: "necessary",
  GENERAL_MERCHANDISE_PET_SUPPLIES: "necessary",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "fun",
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "fun",
  GENERAL_MERCHANDISE_ELECTRONICS: "fun",
  GENERAL_MERCHANDISE_SPORTING_GOODS: "fun",
  GENERAL_SERVICES_INSURANCE: "fixed",
  PERSONAL_CARE_GYM_AND_FITNESS_CENTERS: "fixed",
  PERSONAL_CARE_HAIR_AND_BEAUTY: "fun",
  RENT_AND_UTILITIES_RENT: "fixed",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "fixed",
  RENT_AND_UTILITIES_TELEPHONE: "fixed",
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "fixed",
  RENT_AND_UTILITIES_WATER: "fixed",
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE: "fixed",
  ENTERTAINMENT_STREAMING_SERVICES: "fixed",
  BANK_FEES_OVERDRAFT_FEES: "necessary",
};

const PRIMARY_MAP: Record<string, Classification> = {
  INCOME: "income",
  TRANSFER_IN: "transfer",
  TRANSFER_OUT: "transfer",
  LOAN_PAYMENTS: "fixed",
  BANK_FEES: "necessary",
  ENTERTAINMENT: "fun",
  FOOD_AND_DRINK: "fun",
  GENERAL_MERCHANDISE: "fun",
  HOME_IMPROVEMENT: "necessary",
  MEDICAL: "necessary",
  PERSONAL_CARE: "necessary",
  GENERAL_SERVICES: "necessary",
  GOVERNMENT_AND_NON_PROFIT: "necessary",
  TRANSPORTATION: "necessary",
  TRAVEL: "fun",
  RENT_AND_UTILITIES: "fixed",
};

const SUBCATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK: "Dining",
  GENERAL_MERCHANDISE: "Shopping",
  TRAVEL: "Travel",
  ENTERTAINMENT: "Entertainment",
  TRANSPORTATION: "Transportation",
  MEDICAL: "Health",
  PERSONAL_CARE: "Personal care",
  RENT_AND_UTILITIES: "Housing",
  LOAN_PAYMENTS: "Debt",
  INCOME: "Income",
};

export function subcategoryFor(primary?: string | null): string | null {
  if (!primary) return null;
  return SUBCATEGORY_MAP[primary] ?? null;
}

export interface ClassifyInput {
  amount: number;
  accountType: Account["type"];
  merchantKey: string;
  plaidCategoryPrimary?: string | null;
  plaidCategoryDetailed?: string | null;
  /** True when a matching transaction on another own account was found. */
  isInternalTransfer?: boolean;
}

export interface ClassifyContext {
  merchantRules: MerchantRule[];
  recurringObligations: RecurringObligation[];
}

/**
 * Decides the bucket for a transaction. Precedence, highest first:
 *   1. An explicit merchant rule the user created.
 *   2. A detected internal transfer between the user's own accounts.
 *   3. A confirmed recurring obligation with the same merchant key.
 *   4. Plaid's detailed category, then its primary category.
 *   5. Sign-based fallback.
 */
export function classifyTransaction(
  input: ClassifyInput,
  context: ClassifyContext,
): { classification: Classification; subcategory: string | null } {
  const subcategory = subcategoryFor(input.plaidCategoryPrimary);

  // 1. User rules win outright.
  const rule = context.merchantRules.find(
    (r) => r.merchantKey && r.merchantKey === input.merchantKey,
  );
  if (rule) {
    return {
      classification: rule.classification,
      subcategory: rule.subcategory ?? subcategory,
    };
  }

  // 2. Money moving between the user's own accounts is never income or expense.
  if (input.isInternalTransfer) {
    return { classification: "transfer", subcategory };
  }

  // A credit-card payment: an inflow landing on a credit account. The matching
  // outflow from checking is caught by internal-transfer pairing above.
  if (input.accountType === "credit" && input.amount > 0) {
    return { classification: "transfer", subcategory };
  }

  // 3. A confirmed recurring bill takes its category from the obligation.
  const obligation = context.recurringObligations.find(
    (o) => o.isActive && o.merchantKey && o.merchantKey === input.merchantKey,
  );
  if (obligation && input.amount < 0) {
    return { classification: obligation.category, subcategory };
  }

  // 4. Plaid taxonomy.
  const detailed = input.plaidCategoryDetailed
    ? DETAILED_MAP[input.plaidCategoryDetailed]
    : undefined;
  if (detailed) {
    // Plaid labels some inflows INCOME even on a credit account; a credit
    // account can never receive income.
    if (detailed === "income" && input.accountType === "credit") {
      return { classification: "transfer", subcategory };
    }
    return { classification: detailed, subcategory };
  }

  const primary = input.plaidCategoryPrimary
    ? PRIMARY_MAP[input.plaidCategoryPrimary]
    : undefined;
  if (primary) {
    if (primary === "income" && input.amount < 0) {
      // An outflow categorized INCOME is a reversal, not income.
      return { classification: "ignore", subcategory };
    }
    if (primary === "income" && input.accountType === "credit") {
      return { classification: "transfer", subcategory };
    }
    return { classification: primary, subcategory };
  }

  // 5. Fallback. An unexplained inflow on a depository account is NOT assumed
  // to be income — that would inflate the plan. It is parked as a transfer for
  // the user to confirm.
  if (input.amount > 0) {
    return { classification: "transfer", subcategory };
  }
  return { classification: "necessary", subcategory };
}

/**
 * Marks matched pairs of opposite-sign, equal-magnitude transactions across the
 * user's own accounts as internal transfers.
 *
 * This is what stops a $820 credit-card payment from being counted as $820 of
 * new spending on top of the purchases it settles.
 */
export function detectInternalTransfers(
  transactions: Transaction[],
  windowDays = 4,
): Set<string> {
  const matched = new Set<string>();
  const outflows = transactions.filter((t) => t.amount < 0);
  const inflows = transactions.filter((t) => t.amount > 0);

  for (const out of outflows) {
    if (matched.has(out.id)) continue;
    const outDate = new Date(`${out.date}T12:00:00`).getTime();

    const partner = inflows.find((inflow) => {
      if (matched.has(inflow.id)) return false;
      if (inflow.accountId === out.accountId) return false;
      if (Math.abs(Math.abs(inflow.amount) - Math.abs(out.amount)) > 0.005) return false;
      const inDate = new Date(`${inflow.date}T12:00:00`).getTime();
      return Math.abs(inDate - outDate) <= windowDays * 86_400_000;
    });

    if (partner) {
      matched.add(out.id);
      matched.add(partner.id);
    }
  }

  return matched;
}

/**
 * Drops pending transactions that a posted transaction has already superseded.
 *
 * Plaid links the two via `pending_transaction_id`. Without this, the week a
 * charge posts it would be counted twice.
 */
export function dedupePendingPosted(transactions: Transaction[]): Transaction[] {
  const supersededPlaidIds = new Set(
    transactions
      .map((t) => t.pendingTransactionId)
      .filter((id): id is string => Boolean(id)),
  );

  if (supersededPlaidIds.size === 0) return transactions;

  return transactions.filter((t) => {
    if (!t.pending) return true;
    if (t.plaidTransactionId && supersededPlaidIds.has(t.plaidTransactionId)) {
      return false;
    }
    return true;
  });
}

/**
 * A refund is an inflow that reverses an earlier purchase rather than new
 * income. It keeps the classification of the thing it reverses, so a returned
 * dress reduces fun spending instead of appearing as a paycheck.
 */
export function isLikelyRefund(input: {
  amount: number;
  accountType: Account["type"];
  plaidCategoryPrimary?: string | null;
  name: string;
}): boolean {
  if (input.amount <= 0) return false;
  if (input.accountType === "credit") {
    // On a credit account an inflow is either a payment or a refund. Payments
    // are caught by internal-transfer pairing; what's left is refunds.
    return !/payment|autopay|thank you/i.test(input.name);
  }
  return /refund|return|reversal|credit adjustment/i.test(input.name);
}
