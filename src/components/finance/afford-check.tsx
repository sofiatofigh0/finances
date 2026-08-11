"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, TriangleAlert } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Field, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { PurchaseScenarioResult } from "@/lib/finance/scenario";
import { formatMoney, formatShortDate } from "@/lib/utils";

/**
 * "Can I afford this?" — the deterministic simulator, surfaced as a first-class
 * flow rather than buried in chat. The verdict and every number come from the
 * engine; nothing here is generated text.
 */
export function AffordCheck({
  open,
  onOpenChange,
  initialAmount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAmount?: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [classification, setClassification] = useState("fun");
  const [result, setResult] = useState<PurchaseScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, description, date, classification }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "We couldn't run that simulation.");
        return;
      }
      setResult(data.scenario as PurchaseScenarioResult);
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        setResult(null);
        setAmount("");
        setDescription("");
      }, 200);
      router.refresh();
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title="Can I afford this?"
        description={
          result
            ? undefined
            : "Spendable simulates the purchase against your real plan and cash flow."
        }
      >
        {result ? (
          <ScenarioResult result={result} onAgain={reset} />
        ) : (
          <form onSubmit={run} noValidate>
            <Field label="Amount">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="450"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>

            <Field label="What is it? (optional)">
              <Input
                placeholder="Dress"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="When">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Type">
                <Select
                  value={classification}
                  onChange={(e) => setClassification(e.target.value)}
                >
                  <option value="fun">Fun</option>
                  <option value="necessary">Necessary</option>
                  <option value="fixed">Fixed</option>
                  <option value="goals">Goal</option>
                </Select>
              </Field>
            </div>

            {error ? (
              <p
                role="alert"
                className="mb-3 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
              >
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Checking…" : "Check it"}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

const VERDICT = {
  affordable: {
    icon: Check,
    tone: "positive" as const,
    bg: "bg-[var(--color-positive-soft)] text-[var(--color-positive)]",
  },
  tight: {
    icon: TriangleAlert,
    tone: "caution" as const,
    bg: "bg-[var(--color-caution-soft)] text-[var(--color-caution)]",
  },
  wait: {
    icon: Clock,
    tone: "negative" as const,
    bg: "bg-[var(--color-negative-soft)] text-[var(--color-negative)]",
  },
};

export function ScenarioResult({
  result,
  onAgain,
}: {
  result: PurchaseScenarioResult;
  onAgain?: () => void;
}) {
  const verdict = VERDICT[result.verdict];
  const Icon = verdict.icon;

  return (
    <div>
      <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${verdict.bg}`}>
        <Icon className="size-5 shrink-0" />
        <div>
          <p className="text-[15px] font-semibold">{result.headline}</p>
          {result.input.description ? (
            <p className="text-[12.5px] opacity-80">
              {result.input.description} · {formatMoney(result.input.amount)}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="mt-4">
        <Row
          label="Safe to spend now"
          value={formatMoney(result.safeToSpendBefore)}
        />
        <Row
          label="This purchase"
          value={`− ${formatMoney(result.input.amount)}`}
        />
        <Row
          label="Safe to spend after"
          value={formatMoney(result.safeToSpendAfter)}
          strong
          negative={result.safeToSpendAfter < 0}
        />
        <Row
          label="Weekly pace after"
          value={`${formatMoney(result.weeklyPaceAfter)}/week`}
        />
        <Row
          label="Lowest projected cash"
          value={formatMoney(result.lowestProjectedCashAfter)}
          note={`on ${formatShortDate(result.lowestProjectedDateAfter)}`}
        />
        <Row
          label="Cash buffer"
          value={formatMoney(result.cashBuffer)}
          badge={result.bufferMaintained ? "Maintained" : "Would break"}
          badgeTone={result.bufferMaintained ? "positive" : "negative"}
        />
        <Row
          label="Upcoming obligations"
          value=""
          badge={result.upcomingObligationsCovered ? "Covered" : "At risk"}
          badgeTone={result.upcomingObligationsCovered ? "positive" : "negative"}
        />
        <Row
          label="Goals"
          value=""
          badge={result.goalsIntact ? "Unaffected" : "Behind pace"}
          badgeTone={result.goalsIntact ? "positive" : "caution"}
        />
      </dl>

      {result.earliestComfortableDate ? (
        <div className="mt-4 rounded-xl bg-[var(--color-surface-sunken)] p-4">
          <p className="text-[13px] font-semibold">
            Earliest comfortable date:{" "}
            {formatShortDate(result.earliestComfortableDate)}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Based on the money you already know is coming in and going out.
          </p>
        </div>
      ) : null}

      {result.reasons.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {result.reasons.map((reason, i) => (
            <li
              key={i}
              className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]"
            >
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      {onAgain ? (
        <Button variant="secondary" className="mt-5 w-full" onClick={onAgain}>
          Check something else
        </Button>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  note,
  strong,
  negative,
  badge,
  badgeTone,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  negative?: boolean;
  badge?: string;
  badgeTone?: "positive" | "negative" | "caution";
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-[var(--color-border-subtle)] py-2.5 last:border-0">
      <dt
        className={
          strong
            ? "text-[14px] font-semibold"
            : "text-[13px] text-[var(--color-ink-muted)]"
        }
      >
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        {value ? (
          <span
            className={`tnum text-[14px] ${
              strong ? "font-semibold" : ""
            } ${negative ? "text-[var(--color-negative)]" : ""}`}
          >
            {value}
          </span>
        ) : null}
        {badge ? <Badge tone={badgeTone ?? "neutral"}>{badge}</Badge> : null}
      </dd>
      {note ? (
        <p className="w-full text-[11.5px] text-[var(--color-ink-faint)]">{note}</p>
      ) : null}
    </div>
  );
}
