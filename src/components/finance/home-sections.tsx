import Link from "next/link";
import { ArrowRight, CalendarClock, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import type { GoalProgress } from "@/lib/finance/goals";
import type { CashFlowEvent, MonthlyPlan } from "@/lib/finance/types";
import { formatMoney, formatShortDate } from "@/lib/utils";

/** Income in, commitments out, fun left. Deliberately six lines, not forty. */
export function QuickBreakdown({ plan }: { plan: MonthlyPlan }) {
  const rows = [
    { label: "Income", amount: plan.expectedIncome, positive: true },
    { label: "Committed", amount: -plan.fixedCommitments },
    { label: "Necessary remaining", amount: -plan.necessaryRemaining },
    { label: "Goals", amount: -plan.goalContributions },
    { label: "Fun spent", amount: -plan.funSpent },
  ];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>This month</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <dl>
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 py-1.5"
            >
              <dt className="text-[13.5px] text-[var(--color-ink-muted)]">
                {row.label}
              </dt>
              <dd
                className={`tnum text-[14px] ${
                  row.positive
                    ? "text-[var(--color-positive)]"
                    : "text-[var(--color-ink)]"
                }`}
              >
                {row.amount < 0 ? "−" : ""}
                {formatMoney(Math.abs(row.amount))}
              </dd>
            </div>
          ))}
          <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-3">
            <dt className="text-[14px] font-semibold">Fun remaining</dt>
            <dd
              className={`tnum text-[16px] font-semibold ${
                plan.remainingMonthlyFunBudget < 0
                  ? "text-[var(--color-negative)]"
                  : "text-[var(--color-ink)]"
              }`}
            >
              {plan.remainingMonthlyFunBudget < 0 ? "−" : ""}
              {formatMoney(Math.abs(plan.remainingMonthlyFunBudget))}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** The next few things that will actually move cash. */
export function UpcomingEvents({ events }: { events: CashFlowEvent[] }) {
  const next = events.slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Upcoming</CardTitle>
        <Link
          href="/plan"
          className="flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-ink-muted)]"
        >
          Full forecast <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {next.length === 0 ? (
          <p className="py-2 text-[13px] text-[var(--color-ink-muted)]">
            Nothing scheduled in the next few weeks. Add your rent, bills, and
            paycheck on the Plan tab so Spendable can see what&apos;s coming.
          </p>
        ) : (
          <ul>
            {next.map((event, index) => (
              <li
                key={`${event.sourceId}-${event.date}-${index}`}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CalendarClock className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">
                      {event.label}
                    </p>
                    <p className="text-[12px] text-[var(--color-ink-faint)]">
                      {formatShortDate(event.date)}
                    </p>
                  </div>
                </div>
                <span
                  className={`tnum shrink-0 text-[14px] ${
                    event.amount > 0
                      ? "text-[var(--color-positive)]"
                      : "text-[var(--color-ink)]"
                  }`}
                >
                  {event.amount > 0 ? "+" : "−"}
                  {formatMoney(Math.abs(event.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const GOAL_TONE = {
  complete: "positive",
  ahead: "positive",
  on_track: "positive",
  behind: "caution",
  no_target: "neutral",
} as const;

const GOAL_LABEL = {
  complete: "Funded",
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  no_target: "No target",
} as const;

export function GoalsPreview({ goals }: { goals: GoalProgress[] }) {
  const top = goals.slice(0, 2);

  if (top.length === 0) {
    return (
      <EmptyState
        icon={<Target className="size-5" />}
        title="What are you saving toward?"
        description="Add a goal and Spendable will protect its monthly contribution before it calls anything safe to spend."
        action={
          <Link
            href="/goals"
            className="inline-flex h-11 items-center rounded-xl bg-[var(--color-ink)] px-5 text-sm font-medium text-[var(--color-surface)]"
          >
            Add a goal
          </Link>
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Goals</CardTitle>
        <Link
          href="/goals"
          className="flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-ink-muted)]"
        >
          All goals <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-4">
          {top.map((item) => (
            <li key={item.goal.id}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="truncate text-[13.5px] font-medium">
                  {item.goal.name}
                </p>
                <Badge tone={GOAL_TONE[item.status]}>
                  {GOAL_LABEL[item.status]}
                </Badge>
              </div>
              <Progress
                value={item.progress ?? 0}
                tone={item.status === "behind" ? "caution" : "accent"}
              />
              <p className="tnum mt-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
                {formatMoney(item.goal.currentAmount)}
                {item.goal.targetAmount
                  ? ` / ${formatMoney(item.goal.targetAmount)}`
                  : ""}
                {item.requiredMonthlyContribution != null
                  ? ` · needs ${formatMoney(item.requiredMonthlyContribution)}/mo`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
