import type {
  AccountBase,
  CreditCardLiability,
  MortgageLiability,
  StudentLoan,
  Transaction as PlaidTransaction,
} from "plaid";
import { merchantKeyFor } from "@/lib/finance/classify";
import type { AccountType } from "@/lib/finance/types";

/**
 * Pure mapping from Plaid's shapes into our normalized rows.
 *
 * Kept separate from the sync orchestration so the conversions — especially
 * the sign inversion, which everything downstream depends on — can be reasoned
 * about and tested in isolation.
 */

const LIQUID_SUBTYPES = new Set([
  "checking",
  "cash management",
  "prepaid",
  "ebt",
]);

export function mapAccountType(plaidType: string): AccountType {
  switch (plaidType) {
    case "depository":
      return "depository";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
    case "brokerage":
      return "investment";
    default:
      return "other";
  }
}

/**
 * Whether an account's balance counts as spendable liquid cash.
 * Checking counts; savings deliberately does not by default, because savings
 * usually backs a goal. The user can flip this per account in Settings.
 */
export function isLiquidByDefault(plaidType: string, subtype: string | null): boolean {
  if (mapAccountType(plaidType) !== "depository") return false;
  return LIQUID_SUBTYPES.has((subtype ?? "").toLowerCase());
}

export interface NormalizedAccount {
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: AccountType;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  currency: string;
  is_liquid: boolean;
}

export function normalizeAccount(account: AccountBase): NormalizedAccount {
  const subtype = (account.subtype as string | null) ?? null;
  return {
    plaid_account_id: account.account_id,
    name: account.name,
    official_name: account.official_name ?? null,
    mask: account.mask ?? null,
    type: mapAccountType(account.type as string),
    subtype,
    current_balance: account.balances.current ?? null,
    available_balance: account.balances.available ?? null,
    credit_limit: account.balances.limit ?? null,
    currency: account.balances.iso_currency_code ?? "USD",
    is_liquid: isLiquidByDefault(account.type as string, subtype),
  };
}

export interface NormalizedTransaction {
  plaid_transaction_id: string;
  plaid_account_id: string;
  /** Sign-inverted: negative = outflow, positive = inflow. */
  amount: number;
  currency: string;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  merchant_key: string;
  pending: boolean;
  pending_transaction_id: string | null;
  plaid_category_primary: string | null;
  plaid_category_detailed: string | null;
}

/**
 * THE SIGN INVERSION.
 *
 * Plaid reports a positive `amount` for money leaving a depository account and
 * for a purchase on a credit card. We store the opposite so that a single rule
 * holds everywhere in the app: negative means money left, positive means money
 * arrived. This also makes credit-card mechanics fall out correctly — a card
 * purchase becomes negative (spending) and a card payment becomes positive on
 * the card and negative on checking.
 */
export function normalizeTransaction(
  transaction: PlaidTransaction,
): NormalizedTransaction {
  return {
    plaid_transaction_id: transaction.transaction_id,
    plaid_account_id: transaction.account_id,
    amount: -transaction.amount,
    currency: transaction.iso_currency_code ?? "USD",
    date: transaction.date,
    authorized_date: transaction.authorized_date ?? null,
    name: transaction.name,
    merchant_name: transaction.merchant_name ?? null,
    merchant_key: merchantKeyFor(transaction.merchant_name, transaction.name),
    pending: transaction.pending ?? false,
    pending_transaction_id: transaction.pending_transaction_id ?? null,
    plaid_category_primary:
      transaction.personal_finance_category?.primary ?? null,
    plaid_category_detailed:
      transaction.personal_finance_category?.detailed ?? null,
  };
}

export interface NormalizedLiability {
  plaid_account_id: string;
  liability_type: "credit" | "student" | "mortgage";
  last_statement_balance: number | null;
  last_statement_issue_date: string | null;
  minimum_payment: number | null;
  next_payment_due_date: string | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  apr_percentage: number | null;
  apr_type: string | null;
  origination_principal: number | null;
  outstanding_balance: number | null;
  expected_payoff_date: string | null;
  term_months: number | null;
  is_overdue: boolean | null;
}

export function normalizeCreditLiability(
  liability: CreditCardLiability,
): NormalizedLiability | null {
  if (!liability.account_id) return null;

  // Prefer the purchase APR, which is what actually applies to a carried
  // balance for most users.
  const aprs = liability.aprs ?? [];
  const purchase =
    aprs.find((a) => a.apr_type === "purchase_apr") ?? aprs[0] ?? null;

  return {
    plaid_account_id: liability.account_id,
    liability_type: "credit",
    last_statement_balance: liability.last_statement_balance ?? null,
    last_statement_issue_date: liability.last_statement_issue_date ?? null,
    minimum_payment: liability.minimum_payment_amount ?? null,
    next_payment_due_date: liability.next_payment_due_date ?? null,
    last_payment_amount: liability.last_payment_amount ?? null,
    last_payment_date: liability.last_payment_date ?? null,
    apr_percentage: purchase?.apr_percentage ?? null,
    apr_type: purchase?.apr_type ?? null,
    origination_principal: null,
    outstanding_balance: null,
    expected_payoff_date: null,
    term_months: null,
    is_overdue: liability.is_overdue ?? null,
  };
}

export function normalizeStudentLoan(loan: StudentLoan): NormalizedLiability | null {
  if (!loan.account_id) return null;
  return {
    plaid_account_id: loan.account_id,
    liability_type: "student",
    last_statement_balance: null,
    last_statement_issue_date: null,
    minimum_payment: loan.minimum_payment_amount ?? null,
    next_payment_due_date: loan.next_payment_due_date ?? null,
    last_payment_amount: loan.last_payment_amount ?? null,
    last_payment_date: loan.last_payment_date ?? null,
    apr_percentage: loan.interest_rate_percentage ?? null,
    apr_type: "interest_rate",
    origination_principal: loan.origination_principal_amount ?? null,
    outstanding_balance: loan.outstanding_interest_amount ?? null,
    expected_payoff_date: loan.expected_payoff_date ?? null,
    term_months: null,
    is_overdue: loan.is_overdue ?? null,
  };
}

export function normalizeMortgage(
  mortgage: MortgageLiability,
): NormalizedLiability | null {
  if (!mortgage.account_id) return null;
  const term = mortgage.loan_term ?? null;
  const termMonths = term ? parseTermToMonths(term) : null;

  return {
    plaid_account_id: mortgage.account_id,
    liability_type: "mortgage",
    last_statement_balance: null,
    last_statement_issue_date: null,
    minimum_payment: mortgage.next_monthly_payment ?? null,
    next_payment_due_date: mortgage.next_payment_due_date ?? null,
    last_payment_amount: mortgage.last_payment_amount ?? null,
    last_payment_date: mortgage.last_payment_date ?? null,
    apr_percentage: mortgage.interest_rate?.percentage ?? null,
    apr_type: mortgage.interest_rate?.type ?? null,
    origination_principal: mortgage.origination_principal_amount ?? null,
    outstanding_balance: mortgage.past_due_amount ?? null,
    expected_payoff_date: mortgage.maturity_date ?? null,
    term_months: termMonths,
    is_overdue: null,
  };
}

/** Plaid returns loan terms like "30 year" or "360 month". */
function parseTermToMonths(term: string): number | null {
  const match = term.match(/(\d+)\s*(year|month)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2].toLowerCase() === "year" ? value * 12 : value;
}
