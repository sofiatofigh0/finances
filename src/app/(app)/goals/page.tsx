import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { loadFinancialContext } from "@/lib/db/context";
import { computeAllGoalProgress, type GoalProgress } from "@/lib/finance/goals";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, AddButton } from "@/components/finance/entity-form";
import { saveGoal, deleteGoal } from "@/app/actions/finance";
import { formatMoney, formatMonthYear, formatShortDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Goals" };
export const dynamic = "force-dynamic";

const GOAL_TYPES = [
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "savings", label: "General savings" },
  { value: "debt_payoff", label: "Debt payoff" },
  { value: "travel", label: "Travel" },
  { value: "purchase", label: "A purchase" },
  { value: "other", label: "Something else" },
];

const STATUS: Record<
  GoalProgress["status"],
  { label: string; tone: "positive" | "caution" | "neutral" }
> = {
  complete: { label: "Funded", tone: "positive" },
  ahead: { label: "Ahead", tone: "positive" },
  on_track: { label: "On track", tone: "positive" },
  behind: { label: "Behind", tone: "caution" },
  no_target: { label: "No target set", tone: "neutral" },
};

function goalFields(goal?: GoalProgress["goal"]) {
  return [
    { kind: "text" as const, name: "name", label: "Goal name", required: true, placeholder: "Emergency Fund", defaultValue: goal?.name },
    { kind: "select" as const, name: "goal_type", label: "Type", options: GOAL_TYPES, defaultValue: goal?.goalType ?? "savings" },
    { kind: "money" as const, name: "current_amount", label: "Saved so far", defaultValue: goal?.currentAmount ?? 0 },
    { kind: "money" as const, name: "target_amount", label: "Target amount", placeholder: "10000", defaultValue: goal?.targetAmount ?? undefined },
    { kind: "date" as const, name: "target_date", label: "Target date", defaultValue: goal?.targetDate ?? undefined },
    { kind: "money" as const, name: "desired_monthly_contribution", label: "Monthly contribution", hint: "Protected before anything is called safe to spend.", defaultValue: goal?.desiredMonthlyContribution ?? 0 },
    { kind: "number" as const, name: "priority", label: "Priority (1 = highest)", defaultValue: goal?.priority ?? 3 },
    {
      kind: "checkbox" as const,
      name: "contributions_leave_checking",
      label: "This moves money out of checking",
      hint: "Turn off if the contribution is only an internal target and no cash actually leaves.",
      defaultChecked: goal?.contributionsLeaveChecking ?? true,
    },
  ];
}

export default async function GoalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const context = await loadFinancialContext(user.id, new Date(), supabase);
  const goals = computeAllGoalProgress(context.goals, context.asOf);

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-8">
      <header className="safe-top mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Goals</h1>
          <p className="text-[12.5px] text-[var(--color-ink-faint)]">
            Protected before anything is called safe to spend
          </p>
        </div>
        <EntityForm
          trigger={<AddButton label="New goal" />}
          title="New goal"
          description="Set a target and Spendable will pace it for you."
          action={saveGoal}
          fields={goalFields()}
        />
      </header>

      {goals.length === 0 ? (
        <EmptyState
          icon={<Target className="size-5" />}
          title="What are you saving toward?"
          description="An emergency fund, a trip, paying off a card — whatever it is, Spendable will work out the monthly pace and protect it."
          action={
            <EntityForm
              trigger={
                <span className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-[var(--color-ink)] px-5 text-sm font-medium text-[var(--color-surface)]">
                  Add your first goal
                </span>
              }
              title="New goal"
              action={saveGoal}
              fields={goalFields()}
            />
          }
        />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {goals.map((item) => {
            const status = STATUS[item.status];
            return (
              <li key={item.goal.id}>
                <Card>
                  <CardContent className="pt-5">
                    <EntityForm
                      trigger={
                        <span className="block w-full cursor-pointer text-left">
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block truncate text-[15px] font-semibold tracking-tight">
                                {item.goal.name}
                              </span>
                              {item.goal.targetDate ? (
                                <span className="mt-0.5 block text-[12px] text-[var(--color-ink-faint)]">
                                  Target {formatShortDate(item.goal.targetDate)}
                                </span>
                              ) : null}
                            </span>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </span>

                          <span className="mt-3.5 block">
                            <Progress
                              value={item.progress ?? 0}
                              tone={item.status === "behind" ? "caution" : "accent"}
                            />
                          </span>

                          <span className="tnum mt-2 block text-[13.5px]">
                            {formatMoney(item.goal.currentAmount)}
                            {item.goal.targetAmount ? (
                              <span className="text-[var(--color-ink-muted)]">
                                {" "}
                                / {formatMoney(item.goal.targetAmount)}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      }
                      title="Edit goal"
                      recordId={item.goal.id}
                      action={saveGoal}
                      deleteAction={deleteGoal}
                      fields={goalFields(item.goal)}
                    />

                    {item.requiredMonthlyContribution != null ? (
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--color-border-subtle)] pt-3.5">
                        <div>
                          <dt className="text-[11.5px] text-[var(--color-ink-faint)]">
                            Required pace
                          </dt>
                          <dd className="tnum mt-0.5 text-[14px] font-medium">
                            {formatMoney(item.requiredMonthlyContribution)}/mo
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11.5px] text-[var(--color-ink-faint)]">
                            Current pace
                          </dt>
                          <dd
                            className={`tnum mt-0.5 text-[14px] font-medium ${
                              item.status === "behind"
                                ? "text-[var(--color-caution)]"
                                : ""
                            }`}
                          >
                            {formatMoney(item.currentMonthlyContribution)}/mo
                          </dd>
                        </div>
                        {item.projectedCompletionMonth ? (
                          <div className="col-span-2">
                            <dt className="text-[11.5px] text-[var(--color-ink-faint)]">
                              At this pace you finish
                            </dt>
                            <dd className="mt-0.5 text-[13.5px]">
                              {formatMonthYear(
                                `${item.projectedCompletionMonth}-01`,
                              )}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : null}

                    {item.status === "behind" &&
                    item.requiredMonthlyContribution != null ? (
                      <p className="mt-3 rounded-xl bg-[var(--color-caution-soft)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-caution)]">
                        Raising your monthly contribution to{" "}
                        {formatMoney(item.requiredMonthlyContribution)} would put
                        this back on pace for {formatShortDate(item.goal.targetDate ?? "")}.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
