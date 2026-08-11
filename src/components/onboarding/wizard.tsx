"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field, Select } from "@/components/ui/input";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";
import { Badge } from "@/components/ui/badge";
import {
  completeOnboarding,
  createManualAccount,
  saveGoal,
  saveObligation,
  saveIncomeSource,
  updateProfile,
  confirmRecurringCandidate,
} from "@/app/actions/finance";
import { formatMoney, FREQUENCY_LABELS } from "@/lib/utils";

/**
 * Short onboarding — six quick steps, not a 25-question questionnaire.
 * Every answer is editable later, and any step can be skipped.
 */

const STEPS = [
  "Connect",
  "Income",
  "Commitments",
  "Essentials",
  "Buffer",
  "Goals",
] as const;

export function OnboardingWizard({
  plaidReady,
  hasAccounts,
  alreadyComplete,
  defaults,
  detected,
}: {
  plaidReady: boolean;
  hasAccounts: boolean;
  alreadyComplete: boolean;
  defaults: { cashBuffer: number; necessaryAllowance: number };
  detected: { id: string; name: string; amount: number; frequency: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  function runAction(
    action: (form: FormData) => Promise<{ ok: boolean; error?: string }>,
    form: FormData,
    onDone: () => void,
  ) {
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setError(result.error ?? "That didn't save.");
        return;
      }
      setError(null);
      onDone();
    });
  }

  function finish() {
    startTransition(async () => {
      await completeOnboarding();
      router.push("/");
      router.refresh();
    });
  }

  return (
    <main className="safe-top safe-bottom mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
      {/* Progress */}
      <div className="mb-8 flex items-center gap-1.5">
        {STEPS.map((label, index) => (
          <div key={label} className="flex-1">
            <div
              className={`h-1 rounded-full transition-colors ${
                index <= step
                  ? "bg-[var(--color-ink)]"
                  : "bg-[var(--color-border-subtle)]"
              }`}
            />
          </div>
        ))}
      </div>

      <p className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
        Step {step + 1} of {STEPS.length}
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
        >
          {error}
        </p>
      ) : null}

      {/* ---------------------------- 1. Connect --------------------------- */}
      {step === 0 ? (
        <section>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            Connect your accounts
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Spendable reads balances and transactions so it can work out what is
            actually safe to spend. It can never move money.
          </p>

          <div className="mt-7 flex flex-col gap-3">
            {plaidReady ? (
              <PlaidLinkButton label="Connect with Plaid" />
            ) : (
              <div className="rounded-xl bg-[var(--color-caution-soft)] p-4">
                <p className="text-[13px] font-medium text-[var(--color-caution)]">
                  Plaid isn&apos;t configured yet
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  You can add everything manually now and connect institutions
                  later — Spendable works fully either way.
                </p>
              </div>
            )}

            <ManualAccountForm
              disabled={isPending}
              onSave={(form) => runAction(createManualAccount, form, () => {})}
            />

            {hasAccounts ? (
              <p className="flex items-center gap-2 text-[13px] text-[var(--color-positive)]">
                <Check className="size-4" /> Accounts added
              </p>
            ) : null}
          </div>

          <StepFooter onNext={next} nextLabel="Continue" />
        </section>
      ) : null}

      {/* ----------------------------- 2. Income --------------------------- */}
      {step === 1 ? (
        <section>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            What comes in?
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Your take-home pay, after tax. This is the top of every calculation.
          </p>

          <form
            className="mt-7"
            action={(form) => runAction(saveIncomeSource, form, next)}
          >
            <Field label="Name">
              <Input name="name" defaultValue="Paycheck" required />
            </Field>
            <Field label="Net amount per paycheck">
              <Input
                name="expected_net_amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="2500"
                required
              />
            </Field>
            <Field label="How often">
              <Select name="frequency" defaultValue="biweekly">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="semimonthly">Twice a month</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>
            <Field label="Next expected">
              <Input
                name="next_expected_date"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={isPending}>
              Save and continue
            </Button>
          </form>

          <SkipLink onSkip={next} />
        </section>
      ) : null}

      {/* -------------------------- 3. Commitments ------------------------- */}
      {step === 2 ? (
        <section>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            Your regular commitments
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Rent first — it&apos;s usually the biggest. You can add the rest on
            the Plan tab.
          </p>

          {detected.length > 0 ? (
            <div className="mt-6 rounded-xl bg-[var(--color-surface-sunken)] p-4">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                <Sparkles className="size-3.5" /> Spotted in your history
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {detected.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px]">{item.name}</p>
                      <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                        ~{formatMoney(item.amount)} ·{" "}
                        {FREQUENCY_LABELS[item.frequency] ?? item.frequency}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        const form = new FormData();
                        form.set("id", item.id);
                        runAction(confirmRecurringCandidate, form, () => {});
                      }}
                      className="shrink-0 rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-surface)]"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form
            className="mt-6"
            action={(form) => runAction(saveObligation, form, next)}
          >
            <Field label="Name">
              <Input name="name" defaultValue="Rent" required />
            </Field>
            <Field label="Amount">
              <Input
                name="amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="2800"
                required
              />
            </Field>
            <Field label="Next due">
              <Input
                name="next_due_date"
                type="date"
                required
                defaultValue={firstOfNextMonth()}
              />
            </Field>
            <input type="hidden" name="frequency" value="monthly" />
            <input type="hidden" name="category" value="fixed" />
            <input type="hidden" name="is_essential" value="on" />

            <Button type="submit" size="lg" className="w-full" disabled={isPending}>
              Save and continue
            </Button>
          </form>

          <SkipLink onSkip={next} />
        </section>
      ) : null}

      {/* --------------------------- 4. Essentials ------------------------- */}
      {step === 3 ? (
        <section>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            Monthly essentials
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            How much do you typically need for groceries, transportation,
            pharmacy, household basics, and similar each month? A rough number is
            fine.
          </p>

          <form
            className="mt-7"
            action={(form) => runAction(updateProfile, form, next)}
          >
            <Field label="Monthly essentials allowance">
              <Input
                name="necessary_monthly_allowance"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                defaultValue={defaults.necessaryAllowance}
                required
              />
            </Field>
            <input type="hidden" name="cash_buffer" value={defaults.cashBuffer} />
            <input type="hidden" name="forecast_days" value="35" />

            <Button type="submit" size="lg" className="w-full" disabled={isPending}>
              Save and continue
            </Button>
          </form>
        </section>
      ) : null}

      {/* ----------------------------- 5. Buffer --------------------------- */}
      {step === 4 ? (
        <section>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            Your cash buffer
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            The minimum you want to keep in checking at all times. This is not a
            savings goal — it&apos;s the floor Safe-to-Spend will never dip
            below.
          </p>

          <form
            className="mt-7"
            action={(form) => runAction(updateProfile, form, next)}
          >
            <Field
              label="Always keep at least"
              hint="Most people start around $1,000 and adjust later."
            >
              <Input
                name="cash_buffer"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                defaultValue={defaults.cashBuffer}
                required
              />
            </Field>
            <input
              type="hidden"
              name="necessary_monthly_allowance"
              value={defaults.necessaryAllowance}
            />
            <input type="hidden" name="forecast_days" value="35" />

            <Button type="submit" size="lg" className="w-full" disabled={isPending}>
              Save and continue
            </Button>
          </form>
        </section>
      ) : null}

      {/* ------------------------------ 6. Goals --------------------------- */}
      {step === 5 ? (
        <section>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            What are you saving toward?
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Spendable protects your goal contributions before it calls anything
            safe to spend.
          </p>

          <form
            className="mt-7"
            action={(form) => runAction(saveGoal, form, finish)}
          >
            <Field label="Goal name">
              <Input name="name" defaultValue="Emergency Fund" required />
            </Field>
            <Field label="Target amount">
              <Input
                name="target_amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="10000"
              />
            </Field>
            <Field label="Saved so far">
              <Input
                name="current_amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                defaultValue="0"
              />
            </Field>
            <Field label="Target date">
              <Input name="target_date" type="date" defaultValue="2027-12-01" />
            </Field>
            <Field
              label="Monthly contribution"
              hint="Protected before fun money is calculated."
            >
              <Input
                name="desired_monthly_contribution"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                defaultValue="0"
              />
            </Field>
            <input type="hidden" name="goal_type" value="emergency_fund" />
            <input type="hidden" name="priority" value="1" />
            <input type="hidden" name="contributions_leave_checking" value="on" />

            <Button type="submit" size="lg" className="w-full" disabled={isPending}>
              {isPending ? "Finishing…" : "See my Safe-to-Spend"}
            </Button>
          </form>

          <button
            type="button"
            onClick={finish}
            disabled={isPending}
            className="mt-4 w-full text-[13px] font-medium text-[var(--color-ink-muted)]"
          >
            Skip and see my number
          </button>
        </section>
      ) : null}

      {alreadyComplete ? (
        <p className="mt-8 text-center">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-[13px] font-medium text-[var(--color-ink-muted)]"
          >
            Back to Home
          </button>
        </p>
      ) : null}
    </main>
  );
}

function StepFooter({
  onNext,
  nextLabel,
}: {
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <Button size="lg" className="mt-7 w-full" onClick={onNext}>
      {nextLabel}
      <ArrowRight className="size-4" />
    </Button>
  );
}

function SkipLink({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="mt-4 w-full text-[13px] font-medium text-[var(--color-ink-muted)]"
    >
      Skip for now
    </button>
  );
}

function ManualAccountForm({
  onSave,
  disabled,
}: {
  onSave: (form: FormData) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        I&apos;ll add something manually
      </Button>
    );
  }

  return (
    <form
      className="rounded-xl border border-[var(--color-border-subtle)] p-4"
      action={(form) => {
        onSave(form);
        setSaved(true);
      }}
    >
      <Field label="Account name">
        <Input name="name" defaultValue="Everyday Checking" required />
      </Field>
      <Field label="Current balance">
        <Input
          name="current_balance"
          type="number"
          step="0.01"
          inputMode="decimal"
          placeholder="4000"
          required
        />
      </Field>
      <input type="hidden" name="type" value="depository" />
      <input type="hidden" name="is_liquid" value="on" />

      <Button type="submit" variant="secondary" className="w-full" disabled={disabled}>
        {saved ? "Add another" : "Add account"}
      </Button>
      {saved ? (
        <Badge tone="positive" className="mt-3">
          Saved
        </Badge>
      ) : null}
    </form>
  );
}

function firstOfNextMonth(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toISOString().slice(0, 10);
}
