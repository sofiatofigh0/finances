import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { computeSafeToSpend, explainSafeToSpend } from "@/lib/finance/safe-to-spend";
import { computeAllGoalProgress } from "@/lib/finance/goals";
import { runExtraDebtPayment, runPurchaseScenario } from "@/lib/finance/scenario";
import { detectRecurringExpenses } from "@/lib/finance/recurrence";
import { dedupePendingPosted, merchantKeyFor } from "@/lib/finance/classify";
import { liquidBalance, totalDebt } from "@/lib/finance/cashflow";
import type { Classification, FinancialContext } from "@/lib/finance/types";
import type { ResultCard } from "./types";

/**
 * Narrowly scoped tools over the deterministic engine.
 *
 * Each tool returns only the rows needed to answer a question — never the raw
 * financial dataset. This keeps token cost bounded and, more importantly, keeps
 * the model from "reasoning" over numbers it should be reading.
 */

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "finance_get_snapshot",
    description:
      "High-level current financial state: liquid cash, total debt, this month's income and spending by bucket, the canonical Safe-to-Spend number, and how fresh the data is. Start here for most questions.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "finance_explain_safe_to_spend",
    description:
      "The deterministic component-by-component breakdown of the current Safe-to-Spend calculation, including which constraint (monthly plan or cash-flow liquidity) is the limiting factor. Use this when the user asks why the number is what it is, or why it changed.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "finance_run_purchase_scenario",
    description:
      "Deterministically simulates a purchase and returns before/after Safe-to-Spend, the effect on projected cash and the cash buffer, whether goals stay intact, and — if the purchase should wait — the earliest comfortable date. Use this for every 'can I afford X' question. Never estimate this yourself.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Purchase amount in dollars." },
        date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD) of the purchase. Defaults to today.",
        },
        description: { type: "string", description: "What the purchase is." },
        classification: {
          type: "string",
          enum: ["fun", "necessary", "fixed", "goals"],
          description:
            "Which bucket the purchase falls into. Defaults to fun (discretionary).",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "finance_get_transactions",
    description:
      "Returns transactions matching a filter. Use the narrowest filter that answers the question and keep the limit small.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "ISO date, inclusive." },
        end_date: { type: "string", description: "ISO date, inclusive." },
        classification: {
          type: "string",
          enum: ["fixed", "necessary", "fun", "goals", "transfer", "income", "ignore"],
        },
        account_id: { type: "string" },
        merchant_search: {
          type: "string",
          description: "Case-insensitive substring match on merchant or description.",
        },
        limit: { type: "number", description: "Max rows (default 25, cap 100)." },
      },
      required: [],
    },
  },
  {
    name: "finance_get_upcoming_cashflows",
    description:
      "Known and projected money movements over the forecast horizon: paychecks, rent, bills, credit-card payments, loan payments, planned expenses, and goal transfers. Includes the lowest projected cash balance and when it occurs.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead (default 35)." },
      },
      required: [],
    },
  },
  {
    name: "finance_get_goals",
    description:
      "Active goals with progress, required monthly pace, current pace, and on-track status.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "finance_get_recurring_expenses",
    description:
      "Confirmed recurring obligations (rent, bills, subscriptions) and, optionally, detected candidates the user has not confirmed yet.",
    input_schema: {
      type: "object",
      properties: {
        include_detected: {
          type: "boolean",
          description: "Also return unconfirmed detected candidates.",
        },
      },
      required: [],
    },
  },
  {
    name: "finance_get_accounts",
    description:
      "Account and liability summaries: balances, credit limits, minimum payments, due dates, APRs, data source, and freshness.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "finance_run_extra_debt_payment",
    description:
      "Deterministically simulates paying an extra amount toward debt and reports the liquidity impact.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        date: { type: "string", description: "ISO date. Defaults to today." },
      },
      required: ["amount"],
    },
  },
  {
    name: "finance_propose_classification_change",
    description:
      "Proposes reclassifying a transaction, or every future transaction from a merchant. This does NOT apply the change — it returns a proposal that the user must explicitly confirm in the app. Say you have suggested it, not that you have done it.",
    input_schema: {
      type: "object",
      properties: {
        transaction_id: { type: "string" },
        merchant_name: {
          type: "string",
          description: "Use when proposing a rule for all future purchases.",
        },
        new_classification: {
          type: "string",
          enum: ["fixed", "necessary", "fun", "goals", "transfer", "income", "ignore"],
        },
        scope: {
          type: "string",
          enum: ["single", "merchant"],
          description: "'single' for one transaction, 'merchant' for a standing rule.",
        },
        reason: { type: "string" },
      },
      required: ["new_classification", "scope"],
    },
  },
];

export type { ResultCard };

export interface ToolExecutionResult {
  output: unknown;
  card?: ResultCard;
}

type ToolInput = Record<string, unknown>;

function str(input: ToolInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numeric(input: ToolInput, key: string): number | undefined {
  const value = input[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Executes a tool call against the user's real context.
 *
 * Every branch reads from `context`, which was loaded server-side under the
 * user's own session — a tool can never reach another user's data.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  context: FinancialContext,
): Promise<ToolExecutionResult> {
  const input = (rawInput ?? {}) as ToolInput;

  switch (name) {
    case "finance_get_snapshot": {
      const result = computeSafeToSpend(context);
      const month = dedupePendingPosted(context.transactions).filter(
        (t) => t.date >= result.plan.monthStart && t.date <= result.plan.monthEnd,
      );

      return {
        output: {
          safe_to_spend: result.amount,
          limiting_factor: result.limitingFactor,
          status: result.status,
          weekly_pace: result.weeklyPace,
          days_remaining_in_month: result.daysRemainingInMonth,
          liquid_cash: liquidBalance(context.accounts),
          total_debt: totalDebt(context),
          cash_buffer: context.profile.cashBuffer,
          month_to_date: {
            expected_income: result.plan.expectedIncome,
            fixed_commitments: result.plan.fixedCommitments,
            necessary_spent: result.plan.necessarySpent,
            necessary_allowance: result.plan.necessaryAllowance,
            fun_spent: result.plan.funSpent,
            fun_remaining: result.plan.remainingMonthlyFunBudget,
            goal_contributions: result.plan.goalContributions,
            transaction_count: month.length,
          },
          data_through: result.dataThrough,
          has_data: result.hasData,
        },
      };
    }

    case "finance_explain_safe_to_spend": {
      const result = computeSafeToSpend(context);
      const explanation = explainSafeToSpend(result);
      return {
        output: {
          safe_to_spend: result.amount,
          limiting_factor: explanation.limitingFactor,
          why: explanation.explanation,
          components: explanation.lines.map((l) => ({
            label: l.label,
            amount: l.amount,
            note: l.note,
          })),
          data_through: result.dataThrough,
        },
        card: { type: "safe_to_spend", payload: { result, explanation } },
      };
    }

    case "finance_run_purchase_scenario": {
      const amount = numeric(input, "amount");
      if (amount === undefined) {
        return { output: { error: "An amount is required to run a scenario." } };
      }
      const scenario = runPurchaseScenario(context, {
        amount,
        date: str(input, "date"),
        description: str(input, "description"),
        classification: str(input, "classification") as
          | "fun"
          | "necessary"
          | "fixed"
          | "goals"
          | undefined,
      });
      return {
        output: scenario,
        card: { type: "scenario", payload: scenario },
      };
    }

    case "finance_run_extra_debt_payment": {
      const amount = numeric(input, "amount");
      if (amount === undefined) {
        return { output: { error: "An amount is required." } };
      }
      return {
        output: runExtraDebtPayment(context, amount, str(input, "date")),
      };
    }

    case "finance_get_transactions": {
      const limit = Math.min(Math.max(numeric(input, "limit") ?? 25, 1), 100);
      const start = str(input, "start_date");
      const end = str(input, "end_date");
      const classification = str(input, "classification") as Classification | undefined;
      const accountId = str(input, "account_id");
      const search = str(input, "merchant_search")?.toLowerCase();

      const accountNames = new Map(context.accounts.map((a) => [a.id, a.name]));

      const rows = dedupePendingPosted(context.transactions)
        .filter((t) => {
          if (start && t.date < start) return false;
          if (end && t.date > end) return false;
          if (classification && t.classification !== classification) return false;
          if (accountId && t.accountId !== accountId) return false;
          if (search) {
            const haystack = `${t.merchantName ?? ""} ${t.name}`.toLowerCase();
            if (!haystack.includes(search)) return false;
          }
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);

      return {
        output: {
          count: rows.length,
          transactions: rows.map((t) => ({
            id: t.id,
            date: t.date,
            merchant: t.merchantName ?? t.name,
            amount: t.amount,
            classification: t.classification,
            subcategory: t.subcategory,
            account: accountNames.get(t.accountId) ?? "Unknown",
            pending: t.pending,
            is_refund: t.isRefund,
          })),
          note: "amount is signed: negative means money left, positive means money arrived.",
        },
      };
    }

    case "finance_get_upcoming_cashflows": {
      const days = numeric(input, "days");
      const scoped: FinancialContext = days
        ? {
            ...context,
            profile: {
              ...context.profile,
              forecastDays: Math.min(Math.max(days, 1), 120),
            },
          }
        : context;

      const result = computeSafeToSpend(scoped);
      return {
        output: {
          starting_liquid_balance: result.forecast.startingLiquidBalance,
          lowest_projected_balance: result.forecast.lowestProjectedBalance,
          lowest_projected_date: result.forecast.lowestProjectedDate,
          cash_buffer: result.forecast.cashBuffer,
          available_liquidity_above_buffer:
            result.forecast.availableLiquidityAboveBuffer,
          events: result.forecast.events.map((e) => ({
            date: e.date,
            label: e.label,
            amount: e.amount,
            kind: e.kind,
          })),
        },
      };
    }

    case "finance_get_goals": {
      const progress = computeAllGoalProgress(context.goals, context.asOf);
      return {
        output: {
          goals: progress.map((p) => ({
            id: p.goal.id,
            name: p.goal.name,
            type: p.goal.goalType,
            current_amount: p.goal.currentAmount,
            target_amount: p.goal.targetAmount,
            target_date: p.goal.targetDate,
            progress: p.progress,
            required_monthly_contribution: p.requiredMonthlyContribution,
            current_monthly_contribution: p.currentMonthlyContribution,
            status: p.status,
            projected_completion_month: p.projectedCompletionMonth,
          })),
        },
        card: { type: "goals", payload: progress },
      };
    }

    case "finance_get_recurring_expenses": {
      const includeDetected = input.include_detected === true;
      const confirmedKeys = new Set(
        context.recurringObligations
          .map((o) => o.merchantKey)
          .filter((k): k is string => Boolean(k)),
      );

      const detected = includeDetected
        ? detectRecurringExpenses(context.transactions, context.asOf, {
            excludeMerchantKeys: confirmedKeys,
          }).slice(0, 10)
        : [];

      return {
        output: {
          confirmed: context.recurringObligations
            .filter((o) => o.isActive)
            .map((o) => ({
              id: o.id,
              name: o.name,
              amount: o.amount,
              frequency: o.frequency,
              next_due_date: o.nextDueDate,
              category: o.category,
              essential: o.isEssential,
              autopay: o.autopay,
              source: o.source,
            })),
          detected_unconfirmed: detected.map((d) => ({
            merchant: d.displayName,
            average_amount: d.averageAmount,
            frequency: d.frequency,
            confidence: d.confidence,
            occurrences: d.occurrenceCount,
            note: "Not confirmed by the user — do not treat as a committed bill.",
          })),
        },
      };
    }

    case "finance_get_accounts": {
      const liabilityByAccount = new Map(
        context.liabilities.map((l) => [l.accountId, l]),
      );
      return {
        output: {
          accounts: context.accounts
            .filter((a) => a.isActive)
            .map((a) => {
              const liability = liabilityByAccount.get(a.id);
              return {
                id: a.id,
                name: a.name,
                institution: a.institutionName,
                type: a.type,
                subtype: a.subtype,
                mask: a.mask,
                current_balance: a.currentBalance,
                available_balance: a.availableBalance,
                credit_limit: a.creditLimit,
                counts_as_liquid_cash: a.isLiquid,
                source: a.source,
                last_updated: a.balanceLastUpdatedAt,
                payment_strategy: a.type === "credit" ? a.paymentStrategy : undefined,
                statement_balance: liability?.lastStatementBalance,
                minimum_payment: liability?.minimumPayment,
                next_payment_due_date: liability?.nextPaymentDueDate,
                apr_percentage: liability?.aprPercentage,
              };
            }),
          manual_liabilities: context.manualLiabilities
            .filter((l) => l.isActive)
            .map((l) => ({
              id: l.id,
              name: l.name,
              type: l.liabilityType,
              current_balance: l.currentBalance,
              apr_percentage: l.aprPercentage,
              minimum_monthly_payment: l.minimumMonthlyPayment,
              planned_monthly_payment: l.plannedMonthlyPayment,
              payment_due_day: l.paymentDueDay,
              last_updated_manually: l.balanceLastUpdatedAt,
              source: "manual",
            })),
        },
      };
    }

    case "finance_propose_classification_change": {
      const scope = str(input, "scope") === "merchant" ? "merchant" : "single";
      const newClassification = str(input, "new_classification") as Classification;
      const transactionId = str(input, "transaction_id");
      const merchantName = str(input, "merchant_name");

      const transaction = transactionId
        ? context.transactions.find((t) => t.id === transactionId)
        : undefined;

      const proposal = {
        scope,
        transaction_id: transactionId ?? null,
        transaction_summary: transaction
          ? {
              merchant: transaction.merchantName ?? transaction.name,
              amount: transaction.amount,
              date: transaction.date,
              current_classification: transaction.classification,
            }
          : null,
        merchant_name:
          merchantName ?? transaction?.merchantName ?? transaction?.name ?? null,
        merchant_key: merchantKeyFor(
          merchantName ?? transaction?.merchantName,
          transaction?.name,
        ),
        new_classification: newClassification,
        reason: str(input, "reason") ?? null,
        applied: false,
        requires_user_confirmation: true,
      };

      return {
        output: {
          ...proposal,
          note: "This has NOT been applied. It is shown to the user for confirmation.",
        },
        card: { type: "proposal", payload: proposal },
      };
    }

    default:
      return { output: { error: `Unknown tool: ${name}` } };
  }
}
