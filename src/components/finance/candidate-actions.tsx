"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmRecurringCandidate,
  dismissRecurringCandidate,
} from "@/app/actions/finance";

/**
 * Confirm / dismiss for a detected recurring stream.
 *
 * A detected pattern is never silently promoted into a committed bill — this
 * is the explicit decision point, and the answer is remembered.
 */
export function CandidateActions({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: (form: FormData) => Promise<{ ok: boolean }>) {
    const form = new FormData();
    form.set("id", id);
    startTransition(async () => {
      await action(form);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(confirmRecurringCandidate)}
        className="rounded-lg bg-[var(--color-ink)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-surface)] disabled:opacity-60"
      >
        Add as regular expense
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(dismissRecurringCandidate)}
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-ink-muted)] disabled:opacity-60"
      >
        Not recurring
      </button>
    </div>
  );
}
