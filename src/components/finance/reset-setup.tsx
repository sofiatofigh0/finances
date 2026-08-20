"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { resetManualSetup } from "@/app/actions/finance";
import { Button } from "@/components/ui/button";

/**
 * Clears hand-entered setup and reopens onboarding.
 *
 * Destructive and not undoable, so it asks first and spells out what goes and
 * what stays — the distinction that matters here is that connected accounts and
 * transaction history survive.
 */
export function ResetSetup() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await resetManualSetup();
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      router.push("/onboarding");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setConfirming(true)}
        >
          <RotateCcw className="size-4" />
          Start setup over
        </Button>
        {error ? (
          <p
            role="alert"
            className="mt-2 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-negative)]"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4">
      <p className="text-[13.5px] font-semibold">Start setup over?</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
        Removes your goals, bills, income, planned expenses, manual accounts and
        debts, and resets your buffer and allowance. Connected institutions,
        balances and transaction history are kept — you&apos;ll go back through
        setup and can accept the bills and income detected from them.
      </p>
      <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
        This can&apos;t be undone.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Keep everything
        </Button>
        <Button className="flex-1" onClick={run} disabled={pending}>
          {pending ? "Clearing…" : "Yes, start over"}
        </Button>
      </div>
    </div>
  );
}
