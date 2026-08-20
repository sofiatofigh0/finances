import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarClock, Sparkles } from "lucide-react";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { loadFinancialContext } from "@/lib/db/context";
import { computeSafeToSpend } from "@/lib/finance/safe-to-spend";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityForm, AddButton } from "@/components/finance/entity-form";
import { CandidateActions } from "@/components/finance/candidate-actions";
import {
  saveObligation,
  deleteObligation,
  saveIncomeSource,
  deleteIncomeSource,
  savePlannedExpense,
  deletePlannedExpense,
} from "@/app/actions/finance";
import {
  formatMoney,
  formatShortDate,
  FREQUENCY_LABELS,
  formatMonthName,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Yearly" },
];

const CATEGORY_OPTIONS = [
  { value: "fixed", label: "Fixed" },
  { value: "necessary", label: "Necessary" },
  { value: "fun", label: "Fun" },
  { value: "goals", label: "Goal" },
];

export default async function PlanPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const context = await loadFinancialContext(user.id, new Date(), supabase);
  const result = computeSafeToSpend(context);
  const plan = result.plan;

  const { data: candidates } = await supabase
    .from("spendable_recurring_candidates")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("confidence", { ascending: false })
    .limit(8);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-8">
      <header className="safe-top mb-4">
        <h1 className="text-[19px] font-semibold tracking-tight">Plan</h1>
        <p className="text-[12.5px] text-[var(--color-ink-faint)]">
          {formatMonthName()} — where your money is already spoken for
        </p>
      </header>

      {/* ------------------------------- This month ------------------------ */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>This month</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <dl>
            <PlanRow label="Expected income" amount={plan.expectedIncome} positive />
            <PlanRow label="Fixed expenses" amount={-plan.fixedCommitments} />
            <PlanRow
              label="Necessary allowance"
              amount={-plan.necessaryAllowance}
              note={`${formatMoney(plan.necessarySpent)} spent so far`}
            />
            {plan.necessaryOverage > 0 ? (
              <PlanRow
                label="Over the necessary allowance"
                amount={-plan.necessaryOverage}
              />
            ) : null}
            <PlanRow label="Debt payments" amount={-plan.plannedDebtPayments} />
            <PlanRow label="Savings & goals" amount={-plan.goalContributions} />
            {plan.plannedOneTimeExpenses > 0 ? (
              <PlanRow
                label="One-time planned expenses"
                amount={-plan.plannedOneTimeExpenses}
              />
            ) : null}
            {plan.bufferContribution > 0 ? (
              <PlanRow
                label="Rebuilding cash buffer"
                amount={-plan.bufferContribution}
              />
            ) : null}
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-3">
              <dt className="text-[14px] font-semibold">Fun available</dt>
              <dd
                className={`tnum text-[17px] font-semibold ${
                  plan.remainingMonthlyFunBudget < 0
                    ? "text-[var(--color-negative)]"
                    : ""
                }`}
              >
                {formatMoney(plan.remainingMonthlyFunBudget)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* ------------------------------- Income ---------------------------- */}
      <Card className="mb-3.5">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Income</CardTitle>
          <EntityForm
            trigger={<AddButton label="Add" />}
            title="Add income"
            description="What lands in your account, after tax."
            action={saveIncomeSource}
            fields={[
              { kind: "text", name: "name", label: "Name", required: true, placeholder: "Paycheck" },
              { kind: "money", name: "expected_net_amount", label: "Net amount", required: true },
              { kind: "select", name: "frequency", label: "How often", options: FREQUENCY_OPTIONS, defaultValue: "biweekly" },
              { kind: "date", name: "next_expected_date", label: "Next expected", defaultValue: today },
            ]}
          />
        </CardHeader>
        <CardContent className="pt-0">
          {context.incomeSources.length === 0 ? (
            <p className="py-1 text-[13px] text-[var(--color-ink-muted)]">
              Add your paycheck so Spendable knows what&apos;s coming in.
            </p>
          ) : (
            <ul>
              {context.incomeSources.map((source) => (
                <li key={source.id}>
                  <EntityForm
                    trigger={
                      <RowButton
                        title={source.name}
                        subtitle={`${FREQUENCY_LABELS[source.frequency]}${
                          source.nextExpectedDate
                            ? ` · next ${formatShortDate(source.nextExpectedDate)}`
                            : ""
                        }`}
                        amount={source.expectedNetAmount}
                        positive
                        badge={
                          !source.isActive
                            ? { label: "Needs confirming", tone: "caution" as const }
                            : source.source === "detected"
                              ? { label: "Detected", tone: "accent" as const }
                              : undefined
                        }
                      />
                    }
                    title="Edit income"
                    recordId={source.id}
                    action={saveIncomeSource}
                    deleteAction={deleteIncomeSource}
                    fields={[
                      { kind: "text", name: "name", label: "Name", required: true, defaultValue: source.name },
                      { kind: "money", name: "expected_net_amount", label: "Net amount", defaultValue: source.expectedNetAmount },
                      { kind: "select", name: "frequency", label: "How often", options: FREQUENCY_OPTIONS, defaultValue: source.frequency },
                      { kind: "date", name: "next_expected_date", label: "Next expected", defaultValue: source.nextExpectedDate ?? today },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* --------------------------- Regular expenses ---------------------- */}
      <Card className="mb-3.5">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Regular expenses</CardTitle>
          <EntityForm
            trigger={<AddButton label="Add" />}
            title="Add a regular expense"
            description="Rent, utilities, subscriptions, insurance — anything that repeats."
            action={saveObligation}
            fields={[
              { kind: "text", name: "name", label: "Name", required: true, placeholder: "Rent" },
              { kind: "money", name: "amount", label: "Amount", required: true, placeholder: "2800" },
              { kind: "select", name: "frequency", label: "How often", options: FREQUENCY_OPTIONS, defaultValue: "monthly" },
              { kind: "date", name: "next_due_date", label: "Next due", required: true, defaultValue: today },
              { kind: "select", name: "category", label: "Category", options: CATEGORY_OPTIONS, defaultValue: "fixed" },
              { kind: "checkbox", name: "is_essential", label: "Essential", hint: "Essential bills are protected before anything else.", defaultChecked: true },
              { kind: "checkbox", name: "autopay", label: "On autopay" },
            ]}
          />
        </CardHeader>
        <CardContent className="pt-0">
          {context.recurringObligations.length === 0 ? (
            <p className="py-1 text-[13px] text-[var(--color-ink-muted)]">
              Add your rent and bills so Spendable can protect them before
              calling anything safe to spend.
            </p>
          ) : (
            <ul>
              {context.recurringObligations.map((item) => (
                <li key={item.id}>
                  <EntityForm
                    trigger={
                      <RowButton
                        title={item.name}
                        subtitle={`${FREQUENCY_LABELS[item.frequency]} · next ${formatShortDate(item.nextDueDate)}`}
                        amount={-item.amount}
                        badge={
                          item.source === "detected"
                            ? { label: "Detected", tone: "accent" as const }
                            : undefined
                        }
                      />
                    }
                    title="Edit regular expense"
                    recordId={item.id}
                    action={saveObligation}
                    deleteAction={deleteObligation}
                    fields={[
                      { kind: "text", name: "name", label: "Name", required: true, defaultValue: item.name },
                      { kind: "money", name: "amount", label: "Amount", defaultValue: item.amount },
                      { kind: "select", name: "frequency", label: "How often", options: FREQUENCY_OPTIONS, defaultValue: item.frequency },
                      { kind: "date", name: "next_due_date", label: "Next due", defaultValue: item.nextDueDate },
                      { kind: "select", name: "category", label: "Category", options: CATEGORY_OPTIONS, defaultValue: item.category },
                      { kind: "checkbox", name: "is_essential", label: "Essential", defaultChecked: item.isEssential },
                      { kind: "checkbox", name: "autopay", label: "On autopay", defaultChecked: item.autopay },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Detected -------------------------- */}
      {candidates && candidates.length > 0 ? (
        <Card className="mb-3.5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--color-ink-faint)]" />
              Possible recurring expenses
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Spotted in your history. Nothing is committed to your plan until
              you confirm it.
            </p>
            <ul className="flex flex-col gap-3">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="rounded-xl bg-[var(--color-surface-sunken)] p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[13.5px] font-medium">
                      {candidate.display_name}
                    </p>
                    <span className="tnum shrink-0 text-[13.5px]">
                      ~{formatMoney(Number(candidate.average_amount))}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">
                    {FREQUENCY_LABELS[candidate.frequency as string]} ·{" "}
                    {candidate.occurrence_count} times seen ·{" "}
                    {Math.round(Number(candidate.confidence) * 100)}% confidence
                  </p>
                  <CandidateActions id={candidate.id as string} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* -------------------------- Planned one-offs ----------------------- */}
      <Card className="mb-3.5">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Planned expenses</CardTitle>
          <EntityForm
            trigger={<AddButton label="Add" />}
            title="Add a planned expense"
            description="A flight, a wedding, an annual fee — something one-off you know is coming."
            action={savePlannedExpense}
            fields={[
              { kind: "text", name: "name", label: "What is it", required: true, placeholder: "Flight to Lisbon" },
              { kind: "money", name: "amount", label: "Amount", required: true },
              { kind: "date", name: "expected_date", label: "Expected date", required: true, defaultValue: today },
              { kind: "select", name: "classification", label: "Type", options: CATEGORY_OPTIONS, defaultValue: "fun" },
              { kind: "checkbox", name: "is_reserved", label: "Already set aside", hint: "Reserved money still leaves checking on the date, but won't reduce your fun money twice." },
            ]}
          />
        </CardHeader>
        <CardContent className="pt-0">
          {context.plannedExpenses.length === 0 ? (
            <p className="py-1 text-[13px] text-[var(--color-ink-muted)]">
              Nothing planned. Add upcoming one-offs so they don&apos;t surprise
              your cash flow.
            </p>
          ) : (
            <ul>
              {context.plannedExpenses.map((item) => (
                <li key={item.id}>
                  <EntityForm
                    trigger={
                      <RowButton
                        title={item.name}
                        subtitle={formatShortDate(item.expectedDate)}
                        amount={-item.amount}
                        badge={
                          item.isReserved
                            ? { label: "Reserved", tone: "positive" as const }
                            : undefined
                        }
                      />
                    }
                    title="Edit planned expense"
                    recordId={item.id}
                    action={savePlannedExpense}
                    deleteAction={deletePlannedExpense}
                    fields={[
                      { kind: "text", name: "name", label: "What is it", defaultValue: item.name },
                      { kind: "money", name: "amount", label: "Amount", defaultValue: item.amount },
                      { kind: "date", name: "expected_date", label: "Expected date", defaultValue: item.expectedDate },
                      { kind: "select", name: "classification", label: "Type", options: CATEGORY_OPTIONS, defaultValue: item.classification },
                      { kind: "checkbox", name: "is_reserved", label: "Already set aside", defaultChecked: item.isReserved },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ Upcoming --------------------------- */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Upcoming cash flow</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-3 text-[12.5px] text-[var(--color-ink-muted)]">
            Lowest projected balance:{" "}
            <strong className="tnum">
              {formatMoney(result.forecast.lowestProjectedBalance)}
            </strong>{" "}
            on {formatShortDate(result.forecast.lowestProjectedDate)} · buffer{" "}
            {formatMoney(result.forecast.cashBuffer)}
          </p>

          {result.forecast.events.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              Nothing scheduled in the next {context.profile.forecastDays} days.
            </p>
          ) : (
            <ul>
              {result.forecast.events.map((event, index) => (
                <li
                  key={`${event.sourceId}-${event.date}-${index}`}
                  className="flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] py-2.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <CalendarClock className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px]">{event.label}</p>
                      <p className="text-[12px] text-[var(--color-ink-faint)]">
                        {formatShortDate(event.date)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`tnum shrink-0 text-[13.5px] ${
                      event.amount > 0 ? "text-[var(--color-positive)]" : ""
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
    </div>
  );
}

function PlanRow({
  label,
  amount,
  positive,
  note,
}: {
  label: string;
  amount: number;
  positive?: boolean;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
      <dt className="text-[13.5px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd
        className={`tnum text-[14px] ${
          positive ? "text-[var(--color-positive)]" : ""
        }`}
      >
        {amount < 0 ? "−" : ""}
        {formatMoney(Math.abs(amount))}
      </dd>
      {note ? (
        <p className="w-full text-[11.5px] text-[var(--color-ink-faint)]">{note}</p>
      ) : null}
    </div>
  );
}

function RowButton({
  title,
  subtitle,
  amount,
  positive,
  badge,
}: {
  title: string;
  subtitle: string;
  amount: number;
  positive?: boolean;
  badge?: { label: string; tone: "accent" | "caution" | "positive" };
}) {
  return (
    <span className="flex w-full cursor-pointer items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] py-2.5 text-left last:border-0">
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium">{title}</span>
          {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--color-ink-faint)]">
          {subtitle}
        </span>
      </span>
      <span
        className={`tnum shrink-0 text-[14px] ${
          positive ? "text-[var(--color-positive)]" : ""
        }`}
      >
        {amount < 0 ? "−" : positive ? "+" : ""}
        {formatMoney(Math.abs(amount))}
      </span>
    </span>
  );
}
