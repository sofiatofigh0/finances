"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import type { ExplanationLine } from "@/lib/finance/safe-to-spend";
import type { SafeToSpendResult } from "@/lib/finance/types";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatMonthName, formatRelativeTime, isStale } from "@/lib/utils";

const STATUS_COPY = {
  on_track: { label: "On track", tone: "positive" as const, dot: "🟢" },
  tight: { label: "Tight month", tone: "caution" as const, dot: "🟠" },
  overcommitted: { label: "Overcommitted", tone: "negative" as const, dot: "🔴" },
};

/**
 * The number the product exists to produce. It dominates the screen, and it is
 * tappable — trust in this figure depends on being able to see how it was built.
 */
export function SafeToSpendHero({
  result,
  explanation,
}: {
  result: SafeToSpendResult;
  explanation: { lines: ExplanationLine[]; explanation: string };
}) {
  const [open, setOpen] = useState(false);
  const status = STATUS_COPY[result.status];
  const negative = result.amount < 0;
  const stale = isStale(result.dataThrough);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6 py-7 text-left transition-colors hover:bg-[var(--color-surface-sunken)]/40"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-[var(--color-ink-faint)]">
            {negative ? "Over your plan by" : "Safe to spend"}
          </span>
          <Info className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
        </div>

        <p
          className={`tnum mt-2 text-[52px] font-semibold leading-none tracking-[-0.03em] ${
            negative ? "text-[var(--color-negative)]" : "text-[var(--color-ink)]"
          }`}
        >
          {formatMoney(Math.abs(result.amount))}
        </p>

        <p className="mt-2.5 text-[14px] text-[var(--color-ink-muted)]">
          {negative
            ? `Your plan is over-committed for the rest of ${formatMonthName()}.`
            : `for the rest of ${formatMonthName()}`}
        </p>

        {!negative ? (
          <p className="tnum mt-0.5 text-[13px] text-[var(--color-ink-faint)]">
            {formatMoney(result.weeklyPace)}/week at your current plan
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>
            {status.dot} {status.label}
          </Badge>
          <Badge tone="neutral">
            {result.limitingFactor === "liquidity"
              ? "Limited by cash flow"
              : "Limited by your plan"}
          </Badge>
          {stale ? <Badge tone="caution">Data may be out of date</Badge> : null}
        </div>

        {result.dataThrough ? (
          <p className="mt-3 text-[11.5px] text-[var(--color-ink-faint)]">
            Based on data through {formatRelativeTime(result.dataThrough)}
          </p>
        ) : null}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title="How this was calculated"
          description="Every line is a real term from the calculation."
        >
          <dl className="mt-1">
            {explanation.lines.map((line, index) => (
              <div
                key={`${line.label}-${index}`}
                className={
                  line.kind === "total" || line.kind === "constraint"
                    ? "mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-[var(--color-border-subtle)] py-2.5"
                    : "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5"
                }
              >
                <dt
                  className={
                    line.kind === "total"
                      ? "text-[14px] font-semibold"
                      : "text-[13.5px] text-[var(--color-ink-muted)]"
                  }
                >
                  {line.label}
                </dt>
                <dd
                  className={`tnum text-[14px] ${
                    line.kind === "total"
                      ? "font-semibold"
                      : line.amount > 0
                        ? "text-[var(--color-positive)]"
                        : "text-[var(--color-ink-muted)]"
                  }`}
                >
                  {/* Math.abs also normalises -0, which would otherwise
                      render as an odd "−$0". */}
                  {line.amount < 0 ? "−" : ""}
                  {formatMoney(Math.abs(line.amount))}
                </dd>
                {line.note ? (
                  <p className="w-full text-[11.5px] text-[var(--color-ink-faint)]">
                    {line.note}
                  </p>
                ) : null}
              </div>
            ))}
          </dl>

          <div className="mt-4 rounded-xl bg-[var(--color-surface-sunken)] p-4">
            <h3 className="text-[13px] font-semibold">
              Why this is the limiting factor
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              {explanation.explanation}
            </p>
          </div>

          <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
            This number is calculated by Spendable&apos;s financial engine from
            your accounts, bills, and goals. The assistant can explain it, but
            never changes it.
          </p>
        </SheetContent>
      </Sheet>
    </>
  );
}
