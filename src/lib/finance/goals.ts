import { round2 } from "./cashflow";
import { monthsUntil } from "./dates";
import type { Goal } from "./types";

export type GoalStatus = "complete" | "on_track" | "ahead" | "behind" | "no_target";

export interface GoalProgress {
  goal: Goal;
  /** 0–1, clamped. Null when no target amount is set. */
  progress: number | null;
  remainingAmount: number | null;
  monthsRemaining: number | null;
  /** What the user must contribute each month to land on the target date. */
  requiredMonthlyContribution: number | null;
  currentMonthlyContribution: number;
  status: GoalStatus;
  /** Projected completion date at the current pace, ISO YYYY-MM. */
  projectedCompletionMonth: string | null;
}

/**
 * Deterministic goal pacing.
 *
 * The required monthly contribution is recomputed from today every time, so it
 * naturally rises as the target date approaches and the gap has not closed —
 * which is exactly the signal the user needs.
 */
export function computeGoalProgress(goal: Goal, asOf: Date): GoalProgress {
  const currentMonthlyContribution = round2(goal.desiredMonthlyContribution);

  if (goal.targetAmount == null || goal.targetAmount <= 0) {
    return {
      goal,
      progress: null,
      remainingAmount: null,
      monthsRemaining: null,
      requiredMonthlyContribution: null,
      currentMonthlyContribution,
      status: "no_target",
      projectedCompletionMonth: null,
    };
  }

  const remainingAmount = round2(Math.max(0, goal.targetAmount - goal.currentAmount));
  const progress = Math.min(1, Math.max(0, goal.currentAmount / goal.targetAmount));

  if (remainingAmount <= 0) {
    return {
      goal,
      progress: 1,
      remainingAmount: 0,
      monthsRemaining: goal.targetDate ? monthsUntil(goal.targetDate, asOf) : null,
      requiredMonthlyContribution: 0,
      currentMonthlyContribution,
      status: "complete",
      projectedCompletionMonth: null,
    };
  }

  const monthsRemaining = goal.targetDate ? monthsUntil(goal.targetDate, asOf) : null;

  const requiredMonthlyContribution =
    monthsRemaining != null ? round2(remainingAmount / monthsRemaining) : null;

  let status: GoalStatus = "no_target";
  if (requiredMonthlyContribution != null) {
    if (currentMonthlyContribution >= requiredMonthlyContribution * 1.1) {
      status = "ahead";
    } else if (currentMonthlyContribution >= requiredMonthlyContribution * 0.98) {
      status = "on_track";
    } else {
      status = "behind";
    }
  }

  const projectedCompletionMonth =
    currentMonthlyContribution > 0
      ? projectMonth(asOf, Math.ceil(remainingAmount / currentMonthlyContribution))
      : null;

  return {
    goal,
    progress,
    remainingAmount,
    monthsRemaining,
    requiredMonthlyContribution,
    currentMonthlyContribution,
    status,
    projectedCompletionMonth,
  };
}

export function computeAllGoalProgress(goals: Goal[], asOf: Date): GoalProgress[] {
  return goals
    .filter((g) => g.isActive)
    .map((g) => computeGoalProgress(g, asOf))
    .sort((a, b) => a.goal.priority - b.goal.priority);
}

/** True when every goal with a target date is on track or better. */
export function goalsIntact(progress: GoalProgress[]): boolean {
  return progress.every((p) => p.status !== "behind");
}

function projectMonth(asOf: Date, monthsAhead: number): string {
  const d = new Date(asOf.getFullYear(), asOf.getMonth() + monthsAhead, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
