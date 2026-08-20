/**
 * Domain types for the Spendable financial engine.
 *
 * These are deliberately plain data — no Supabase types, no React, no I/O.
 * Everything in `src/lib/finance` is a pure function over these structures so
 * the Safe-to-Spend calculation can be tested exhaustively without a database.
 *
 * SIGN CONVENTION (the single most important rule in this codebase):
 *   `Transaction.amount` is negative for money leaving the user's control and
 *   positive for money arriving. Plaid's raw convention is the opposite and is
 *   inverted at ingest.
 */

export type Classification =
  | "fixed"
  | "necessary"
  | "fun"
  | "goals"
  | "transfer"
  | "income"
  | "ignore";

export type AccountType =
  | "depository"
  | "credit"
  | "loan"
  | "investment"
  | "other";

export type Frequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "irregular";

export type PaymentStrategy =
  | "statement_balance"
  | "minimum_payment"
  | "fixed_amount"
  | "full_balance";

export type ObligationCategory = "fixed" | "necessary" | "fun" | "goals";

export interface Account {
  id: string;
  name: string;
  officialName?: string | null;
  institutionName?: string | null;
  mask?: string | null;
  type: AccountType;
  subtype?: string | null;
  source: "plaid" | "manual";
  currentBalance: number | null;
  availableBalance: number | null;
  creditLimit: number | null;
  /** Counts toward spendable liquid cash in the liquidity guard. */
  isLiquid: boolean;
  isActive: boolean;
  paymentStrategy: PaymentStrategy;
  paymentFixedAmount: number | null;
  balanceLastUpdatedAt: string | null;
}

export interface LiabilityDetail {
  accountId: string;
  liabilityType: "credit" | "student" | "mortgage";
  lastStatementBalance: number | null;
  minimumPayment: number | null;
  nextPaymentDueDate: string | null;
  aprPercentage: number | null;
  outstandingBalance: number | null;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
}

export interface ManualLiability {
  id: string;
  name: string;
  liabilityType: string;
  institutionName?: string | null;
  currentBalance: number;
  aprPercentage: number | null;
  minimumMonthlyPayment: number;
  plannedMonthlyPayment: number;
  paymentDueDay: number | null;
  isActive: boolean;
  balanceLastUpdatedAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  plaidTransactionId?: string | null;
  /** Set on a posted transaction that supersedes an earlier pending one. */
  pendingTransactionId?: string | null;
  /** Negative = outflow, positive = inflow. */
  amount: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  name: string;
  merchantName?: string | null;
  merchantKey?: string | null;
  pending: boolean;
  classification: Classification;
  subcategory?: string | null;
  plaidCategoryPrimary?: string | null;
  plaidCategoryDetailed?: string | null;
  classificationLocked: boolean;
  isRefund: boolean;
}

export interface RecurringObligation {
  id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  nextDueDate: string;
  category: ObligationCategory;
  isEssential: boolean;
  autopay: boolean;
  accountId?: string | null;
  merchantKey?: string | null;
  source: "manual" | "detected";
  isActive: boolean;
}

export interface IncomeSource {
  id: string;
  name: string;
  expectedNetAmount: number;
  frequency: Frequency;
  nextExpectedDate: string | null;
  accountId?: string | null;
  merchantKey?: string | null;
  isActive: boolean;
  source: "manual" | "detected";
}

export interface Goal {
  id: string;
  name: string;
  goalType: string;
  currentAmount: number;
  targetAmount: number | null;
  targetDate: string | null;
  priority: number;
  desiredMonthlyContribution: number;
  accountId?: string | null;
  contributionsLeaveChecking: boolean;
  isActive: boolean;
  notes?: string | null;
}

export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  expectedDate: string;
  classification: ObligationCategory;
  /** Cash already set aside: still leaves checking, but does not re-reduce fun money. */
  isReserved: boolean;
  isSettled: boolean;
}

export interface PlanningProfile {
  cashBuffer: number;
  necessaryMonthlyAllowance: number;
  forecastDays: number;
  currency: string;
}

export interface MonthlyPlanOverride {
  expectedIncome?: number | null;
  necessaryAllowance?: number | null;
  goalContribution?: number | null;
  debtPayment?: number | null;
  buffer?: number | null;
}

/** Everything the engine needs. Assembled once per request by the data layer. */
export interface FinancialContext {
  asOf: Date;
  profile: PlanningProfile;
  accounts: Account[];
  transactions: Transaction[];
  liabilities: LiabilityDetail[];
  manualLiabilities: ManualLiability[];
  recurringObligations: RecurringObligation[];
  incomeSources: IncomeSource[];
  goals: Goal[];
  plannedExpenses: PlannedExpense[];
  monthlyPlanOverride?: MonthlyPlanOverride | null;
  /** Newest source timestamp across accounts/transactions, for freshness UI. */
  dataThrough: string | null;
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export interface MonthlyPlan {
  monthStart: string;
  monthEnd: string;
  expectedIncome: number;
  fixedCommitments: number;
  necessaryAllowance: number;
  necessarySpent: number;
  necessaryRemaining: number;
  necessaryOverage: number;
  plannedDebtPayments: number;
  goalContributions: number;
  plannedOneTimeExpenses: number;
  bufferContribution: number;
  monthlyFunBudget: number;
  funSpent: number;
  remainingMonthlyFunBudget: number;
}

export type CashFlowKind =
  | "income"
  | "recurring"
  | "card_payment"
  | "loan_payment"
  | "planned_expense"
  | "goal_contribution";

export interface CashFlowEvent {
  date: string;
  label: string;
  /** Negative = leaves checking, positive = arrives. */
  amount: number;
  kind: CashFlowKind;
  sourceId: string;
}

export interface CashFlowForecast {
  startDate: string;
  endDate: string;
  startingLiquidBalance: number;
  events: CashFlowEvent[];
  /** End-of-day balances across the horizon, including the starting balance. */
  dailyBalances: { date: string; balance: number }[];
  lowestProjectedBalance: number;
  lowestProjectedDate: string;
  cashBuffer: number;
  availableLiquidityAboveBuffer: number;
}

export type LimitingFactor = "monthly_plan" | "liquidity";

export type SafeToSpendStatus = "on_track" | "tight" | "overcommitted";

export interface SafeToSpendResult {
  /** The canonical number. Never produced by the LLM. */
  amount: number;
  limitingFactor: LimitingFactor;
  status: SafeToSpendStatus;
  /** Days left in the current month, inclusive of today. */
  daysRemainingInMonth: number;
  weeklyPace: number;
  plan: MonthlyPlan;
  forecast: CashFlowForecast;
  dataThrough: string | null;
  /** True when no accounts or balances exist yet — the UI shows an empty state. */
  hasData: boolean;
}
