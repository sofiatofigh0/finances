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

/** Fixed "today" for every test so nothing depends on the wall clock. */
export const TODAY = new Date(2026, 7, 10, 12, 0, 0); // 2026-08-10

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function checking(overrides: Partial<Account> = {}): Account {
  return {
    id: nextId("acct"),
    name: "Everyday Checking",
    officialName: null,
    institutionName: "Test Bank",
    mask: "1234",
    type: "depository",
    subtype: "checking",
    source: "manual",
    currentBalance: 4000,
    availableBalance: 4000,
    creditLimit: null,
    isLiquid: true,
    isActive: true,
    paymentStrategy: "statement_balance",
    paymentFixedAmount: null,
    balanceLastUpdatedAt: TODAY.toISOString(),
    ...overrides,
  };
}

export function savings(overrides: Partial<Account> = {}): Account {
  return checking({
    name: "Savings",
    subtype: "savings",
    currentBalance: 8000,
    availableBalance: 8000,
    // Savings is not spendable liquidity by default: it backs goals.
    isLiquid: false,
    ...overrides,
  });
}

export function creditCard(overrides: Partial<Account> = {}): Account {
  return {
    id: nextId("acct"),
    name: "Rewards Card",
    officialName: null,
    institutionName: "Test Bank",
    mask: "9876",
    type: "credit",
    subtype: "credit card",
    source: "manual",
    currentBalance: 800,
    availableBalance: null,
    creditLimit: 8000,
    isLiquid: false,
    isActive: true,
    paymentStrategy: "statement_balance",
    paymentFixedAmount: null,
    balanceLastUpdatedAt: TODAY.toISOString(),
    ...overrides,
  };
}

export function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId("txn"),
    accountId: "acct-1",
    plaidTransactionId: null,
    pendingTransactionId: null,
    amount: -50,
    date: "2026-08-05",
    name: "Test Merchant",
    merchantName: "Test Merchant",
    merchantKey: "test merchant",
    pending: false,
    classification: "fun",
    subcategory: null,
    plaidCategoryPrimary: null,
    plaidCategoryDetailed: null,
    classificationLocked: false,
    isRefund: false,
    ...overrides,
  };
}

export function income(overrides: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: nextId("inc"),
    name: "Salary",
    expectedNetAmount: 2500,
    frequency: "biweekly",
    nextExpectedDate: "2026-08-14",
    accountId: null,
    merchantKey: "salary",
    isActive: true,
    source: "manual",
    ...overrides,
  };
}

export function obligation(
  overrides: Partial<RecurringObligation> = {},
): RecurringObligation {
  return {
    id: nextId("obl"),
    name: "Rent",
    amount: 2800,
    frequency: "monthly",
    nextDueDate: "2026-09-01",
    category: "fixed",
    isEssential: true,
    autopay: false,
    accountId: null,
    merchantKey: null,
    source: "manual",
    isActive: true,
    ...overrides,
  };
}

export function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: nextId("goal"),
    name: "Emergency Fund",
    goalType: "emergency_fund",
    currentAmount: 2300,
    targetAmount: 10000,
    targetDate: "2027-12-01",
    priority: 1,
    desiredMonthlyContribution: 400,
    accountId: null,
    contributionsLeaveChecking: true,
    isActive: true,
    notes: null,
    ...overrides,
  };
}

export function manualLiability(
  overrides: Partial<ManualLiability> = {},
): ManualLiability {
  return {
    id: nextId("liab"),
    name: "Student Loan",
    liabilityType: "student_loan",
    institutionName: "Test Servicer",
    currentBalance: 18000,
    aprPercentage: 5.5,
    minimumMonthlyPayment: 250,
    plannedMonthlyPayment: 250,
    paymentDueDay: 20,
    isActive: true,
    balanceLastUpdatedAt: TODAY.toISOString(),
    ...overrides,
  };
}

export function plannedExpense(
  overrides: Partial<PlannedExpense> = {},
): PlannedExpense {
  return {
    id: nextId("plan"),
    name: "Flight",
    amount: 400,
    expectedDate: "2026-08-25",
    classification: "fun",
    isReserved: false,
    isSettled: false,
    ...overrides,
  };
}

export function liabilityDetail(
  overrides: Partial<LiabilityDetail> = {},
): LiabilityDetail {
  return {
    accountId: "acct-1",
    liabilityType: "credit",
    lastStatementBalance: 800,
    minimumPayment: 35,
    nextPaymentDueDate: "2026-08-18",
    aprPercentage: 22.99,
    outstandingBalance: 800,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    ...overrides,
  };
}

export function buildContext(
  overrides: Partial<FinancialContext> = {},
): FinancialContext {
  return {
    asOf: TODAY,
    profile: {
      cashBuffer: 1000,
      necessaryMonthlyAllowance: 600,
      forecastDays: 35,
      currency: "USD",
    },
    accounts: [],
    transactions: [],
    liabilities: [],
    manualLiabilities: [],
    recurringObligations: [],
    incomeSources: [],
    goals: [],
    plannedExpenses: [],
    monthlyPlanOverride: null,
    dataThrough: TODAY.toISOString(),
    ...overrides,
  };
}
