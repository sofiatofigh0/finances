"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Receipt } from "lucide-react";
import { reclassifyTransaction } from "@/app/actions/finance";
import {
  CLASSIFICATION_LABELS,
  formatMoney,
  formatShortDate,
} from "@/lib/utils";
import type { Classification } from "@/lib/finance/types";

export interface TransactionRow {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: number;
  accountName: string;
  classification: Classification;
  subcategory: string | null;
  pending: boolean;
  isRefund: boolean;
}

const CLASSIFICATIONS: Classification[] = [
  "fun",
  "necessary",
  "fixed",
  "goals",
  "transfer",
  "income",
  "ignore",
];

const TONE: Record<string, "neutral" | "positive" | "accent" | "caution"> = {
  fun: "accent",
  necessary: "neutral",
  fixed: "neutral",
  goals: "positive",
  transfer: "neutral",
  income: "positive",
  ignore: "neutral",
};

/**
 * The transaction feed.
 *
 * Sign conventions are deliberately invisible to the user: spending reads as
 * spending, income reads as an inflow, and transfers are labelled rather than
 * presented as either.
 */
export function TransactionList({ transactions }: { transactions: TransactionRow[] }) {
  const [selected, setSelected] = useState<TransactionRow | null>(null);

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="size-5" />}
        title="Nothing here yet"
        description="Your activity will appear here after your first sync. Connect an account or add a manual one to get started."
      />
    );
  }

  return (
    <>
      <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        {transactions.map((txn) => {
          const isInflow = txn.amount > 0;
          const isTransfer = txn.classification === "transfer";

          return (
            <li key={txn.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
              <button
                type="button"
                onClick={() => setSelected(txn)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-sunken)]/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {txn.merchantName ?? txn.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--color-ink-faint)]">
                    <span>{formatShortDate(txn.date)}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{txn.accountName}</span>
                    {txn.pending ? <Badge tone="caution">Pending</Badge> : null}
                    {isTransfer ? <Badge tone="neutral">Transfer</Badge> : null}
                    {txn.isRefund ? <Badge tone="positive">Refund</Badge> : null}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p
                    className={`tnum text-[14px] font-medium ${
                      isTransfer
                        ? "text-[var(--color-ink-muted)]"
                        : isInflow
                          ? "text-[var(--color-positive)]"
                          : "text-[var(--color-ink)]"
                    }`}
                  >
                    {isInflow ? "+" : "−"}
                    {formatMoney(Math.abs(txn.amount), { cents: true })}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                    {CLASSIFICATION_LABELS[txn.classification]}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <ReclassifySheet
        transaction={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function ReclassifySheet({
  transaction,
  onClose,
}: {
  transaction: TransactionRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Classification | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(scope: "single" | "merchant") {
    if (!transaction || !choice) return;
    const form = new FormData();
    form.set("transaction_id", transaction.id);
    form.set("classification", choice);
    form.set("scope", scope);

    startTransition(async () => {
      const result = await reclassifyTransaction(form);
      if (!result.ok) {
        setError(result.error ?? "We couldn't save that.");
        return;
      }
      setChoice(null);
      setError(null);
      onClose();
      router.refresh();
    });
  }

  const merchant = transaction?.merchantName ?? transaction?.name ?? "";

  return (
    <Sheet
      open={Boolean(transaction)}
      onOpenChange={(open) => {
        if (!open) {
          setChoice(null);
          setError(null);
          onClose();
        }
      }}
    >
      {transaction ? (
        <SheetContent
          title={merchant}
          description={`${formatShortDate(transaction.date)} · ${formatMoney(
            Math.abs(transaction.amount),
            { cents: true },
          )} · ${transaction.accountName}`}
        >
          <p className="mb-2 text-[13px] font-medium text-[var(--color-ink-muted)]">
            Change how this is counted
          </p>
          <div className="flex flex-wrap gap-2">
            {CLASSIFICATIONS.map((option) => {
              const active =
                (choice ?? transaction.classification) === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setChoice(option)}
                  className={`rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors ${
                    active
                      ? "bg-[var(--color-ink)] text-[var(--color-surface)]"
                      : "border border-[var(--color-border-subtle)] text-[var(--color-ink-muted)]"
                  }`}
                >
                  {CLASSIFICATION_LABELS[option]}
                </button>
              );
            })}
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
            >
              {error}
            </p>
          ) : null}

          {choice && choice !== transaction.classification ? (
            <div className="mt-5 flex flex-col gap-2">
              <Button
                onClick={() => apply("single")}
                disabled={isPending}
                className="w-full"
              >
                Just this transaction
              </Button>
              <Button
                variant="secondary"
                onClick={() => apply("merchant")}
                disabled={isPending}
                className="w-full"
              >
                Apply to all {merchant} purchases
              </Button>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
                A merchant rule is remembered and applied to future purchases.
                You can undo it any time in Settings.
              </p>
            </div>
          ) : null}

          <Badge tone={TONE[transaction.classification]} className="mt-5">
            Currently {CLASSIFICATION_LABELS[transaction.classification]}
          </Badge>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
