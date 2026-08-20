import { addDays } from "date-fns";
import { round2 } from "./cashflow";
import { fromISODate, toISODate } from "./dates";
import type { Frequency, Transaction } from "./types";

/**
 * Fallback recurring-expense detection.
 *
 * Plaid's Recurring Transactions product is used when it is enabled on the
 * account, but the app must not depend on it. This heuristic works from plain
 * transaction history: group by normalized merchant, look for a stable
 * interval and a stable amount, and score the confidence.
 *
 * Detected streams are never silently promoted into committed bills. They are
 * surfaced as "Possible recurring expense" for the user to confirm or dismiss,
 * and that choice is remembered.
 */

export interface RecurringCandidate {
  merchantKey: string;
  displayName: string;
  averageAmount: number;
  frequency: Frequency;
  confidence: number;
  occurrenceCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  nextPredictedDate: string;
}

interface IntervalProfile {
  frequency: Frequency;
  days: number;
  tolerance: number;
}

const PROFILES: IntervalProfile[] = [
  { frequency: "weekly", days: 7, tolerance: 2 },
  { frequency: "biweekly", days: 14, tolerance: 3 },
  { frequency: "semimonthly", days: 15, tolerance: 3 },
  { frequency: "monthly", days: 30.4, tolerance: 5 },
  { frequency: "quarterly", days: 91.3, tolerance: 10 },
  { frequency: "annual", days: 365, tolerance: 20 },
];

export interface DetectOptions {
  minOccurrences?: number;
  minConfidence?: number;
  /** Merchant keys already confirmed or dismissed — excluded from results. */
  excludeMerchantKeys?: Set<string>;
}

export function detectRecurringExpenses(
  transactions: Transaction[],
  asOf: Date,
  options: DetectOptions = {},
): RecurringCandidate[] {
  const minOccurrences = options.minOccurrences ?? 3;
  const minConfidence = options.minConfidence ?? 0.55;
  const exclude = options.excludeMerchantKeys ?? new Set<string>();

  // Only outflows that represent real spending are candidates.
  const relevant = transactions.filter(
    (t) =>
      t.amount < 0 &&
      !t.pending &&
      t.merchantKey &&
      t.classification !== "transfer" &&
      t.classification !== "ignore" &&
      !exclude.has(t.merchantKey),
  );

  const byMerchant = new Map<string, Transaction[]>();
  for (const txn of relevant) {
    const key = txn.merchantKey as string;
    const list = byMerchant.get(key);
    if (list) list.push(txn);
    else byMerchant.set(key, [txn]);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [merchantKey, group] of byMerchant) {
    if (group.length < minOccurrences) continue;

    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const dates = sorted.map((t) => fromISODate(t.date).getTime());

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i += 1) {
      gaps.push((dates[i] - dates[i - 1]) / 86_400_000);
    }
    if (gaps.length === 0) continue;

    const meanGap = mean(gaps);
    const profile = PROFILES.find(
      (p) => Math.abs(meanGap - p.days) <= p.tolerance,
    );
    if (!profile) continue;

    // How tightly the gaps cluster around the expected interval.
    const gapDeviation = mean(gaps.map((g) => Math.abs(g - profile.days)));
    const intervalScore = clamp01(1 - gapDeviation / (profile.tolerance * 2));

    // How stable the amount is. Subscriptions are near-identical; utilities vary.
    const meanAmount = mean(amounts);
    const amountDeviation =
      meanAmount > 0 ? mean(amounts.map((a) => Math.abs(a - meanAmount))) / meanAmount : 1;
    const amountScore = clamp01(1 - amountDeviation * 2.5);

    // More observations means more confidence, saturating at ~6.
    const countScore = clamp01((sorted.length - minOccurrences + 1) / 4);

    const confidence = round3(
      intervalScore * 0.5 + amountScore * 0.35 + countScore * 0.15,
    );
    if (confidence < minConfidence) continue;

    const lastDate = fromISODate(sorted[sorted.length - 1].date);
    let nextPredicted = addDays(lastDate, Math.round(profile.days));
    // If the prediction is already stale, roll it forward.
    let guard = 0;
    while (nextPredicted < asOf && guard < 60) {
      nextPredicted = addDays(nextPredicted, Math.round(profile.days));
      guard += 1;
    }

    candidates.push({
      merchantKey,
      displayName:
        sorted[sorted.length - 1].merchantName || sorted[sorted.length - 1].name,
      averageAmount: round2(meanAmount),
      frequency: profile.frequency,
      confidence,
      occurrenceCount: sorted.length,
      firstSeenDate: sorted[0].date,
      lastSeenDate: sorted[sorted.length - 1].date,
      nextPredictedDate: toISODate(nextPredicted),
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Detects likely recurring INCOME the same way, but with tighter rules: an
 * inflow is only treated as income if it repeats on a payroll-like cadence and
 * is not an internal transfer. Not every inflow is income.
 */
export function detectRecurringIncome(
  transactions: Transaction[],
  asOf: Date,
  options: DetectOptions = {},
): RecurringCandidate[] {
  const inflows = transactions
    .filter(
      (t) =>
        t.amount > 0 &&
        !t.pending &&
        t.merchantKey &&
        t.classification !== "transfer" &&
        t.classification !== "ignore" &&
        !t.isRefund,
    )
    // Flip the sign so the shared detector, which expects outflows, applies.
    .map((t) => ({ ...t, amount: -t.amount }));

  return detectRecurringExpenses(inflows, asOf, {
    minOccurrences: options.minOccurrences ?? 2,
    minConfidence: options.minConfidence ?? 0.6,
    excludeMerchantKeys: options.excludeMerchantKeys,
  }).filter((c) =>
    ["weekly", "biweekly", "semimonthly", "monthly"].includes(c.frequency),
  );
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
