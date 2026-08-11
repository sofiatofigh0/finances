import { describe, expect, it } from "vitest";
import { computeAllGoalProgress, computeGoalProgress } from "@/lib/finance/goals";
import { goal, TODAY } from "./helpers";

describe("Case 10 — goal pacing tightens as the target date approaches", () => {
  it("computes the required monthly contribution from the remaining gap", () => {
    // $7,700 to go, 16 months out => ~$481/month.
    const progress = computeGoalProgress(
      goal({ currentAmount: 2300, targetAmount: 10000, targetDate: "2027-12-01" }),
      TODAY,
    );

    expect(progress.remainingAmount).toBe(7700);
    expect(progress.monthsRemaining).toBe(16);
    expect(progress.requiredMonthlyContribution).toBeCloseTo(481.25, 2);
    expect(progress.progress).toBeCloseTo(0.23, 2);
  });

  it("raises the required contribution as the deadline nears", () => {
    const far = computeGoalProgress(
      goal({ currentAmount: 2300, targetAmount: 10000, targetDate: "2027-12-01" }),
      TODAY,
    );
    const near = computeGoalProgress(
      goal({ currentAmount: 2300, targetAmount: 10000, targetDate: "2026-12-01" }),
      TODAY,
    );

    expect(near.requiredMonthlyContribution!).toBeGreaterThan(
      far.requiredMonthlyContribution!,
    );
    expect(near.monthsRemaining).toBe(4);
    expect(near.requiredMonthlyContribution).toBeCloseTo(1925, 2);
  });

  it("never divides by zero when the target date has passed", () => {
    const progress = computeGoalProgress(
      goal({ currentAmount: 100, targetAmount: 1000, targetDate: "2026-01-01" }),
      TODAY,
    );
    expect(progress.monthsRemaining).toBe(1);
    expect(progress.requiredMonthlyContribution).toBe(900);
    expect(Number.isFinite(progress.requiredMonthlyContribution!)).toBe(true);
  });

  it("labels a goal behind when the pace is short", () => {
    const progress = computeGoalProgress(
      goal({
        currentAmount: 2300,
        targetAmount: 10000,
        targetDate: "2027-12-01",
        desiredMonthlyContribution: 200,
      }),
      TODAY,
    );
    expect(progress.status).toBe("behind");
  });

  it("labels a goal on track when the pace matches", () => {
    const progress = computeGoalProgress(
      goal({
        currentAmount: 2300,
        targetAmount: 10000,
        targetDate: "2027-12-01",
        desiredMonthlyContribution: 482,
      }),
      TODAY,
    );
    expect(progress.status).toBe("on_track");
  });

  it("labels a goal ahead when the pace exceeds the requirement", () => {
    const progress = computeGoalProgress(
      goal({
        currentAmount: 2300,
        targetAmount: 10000,
        targetDate: "2027-12-01",
        desiredMonthlyContribution: 700,
      }),
      TODAY,
    );
    expect(progress.status).toBe("ahead");
  });

  it("marks a fully funded goal complete", () => {
    const progress = computeGoalProgress(
      goal({ currentAmount: 10000, targetAmount: 10000 }),
      TODAY,
    );
    expect(progress.status).toBe("complete");
    expect(progress.remainingAmount).toBe(0);
    expect(progress.progress).toBe(1);
  });

  it("handles a goal with no target amount", () => {
    const progress = computeGoalProgress(
      goal({ targetAmount: null, targetDate: null }),
      TODAY,
    );
    expect(progress.status).toBe("no_target");
    expect(progress.requiredMonthlyContribution).toBeNull();
  });

  it("orders goals by priority and skips inactive ones", () => {
    const all = computeAllGoalProgress(
      [
        goal({ name: "Travel", priority: 3 }),
        goal({ name: "Emergency", priority: 1 }),
        goal({ name: "Archived", priority: 2, isActive: false }),
      ],
      TODAY,
    );
    expect(all.map((p) => p.goal.name)).toEqual(["Emergency", "Travel"]);
  });
});
