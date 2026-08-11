"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { deleteMerchantRule } from "@/app/actions/finance";

/** Standing merchant classification rules, easy to undo. */
export function MerchantRuleList({
  rules,
}: {
  rules: { id: string; displayName: string; classification: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function remove(id: string) {
    const form = new FormData();
    form.set("id", id);
    startTransition(async () => {
      await deleteMerchantRule(form);
      router.refresh();
    });
  }

  return (
    <ul>
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium">
              {rule.displayName}
            </p>
            <p className="text-[12px] text-[var(--color-ink-faint)]">
              Always counted as {rule.classification}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Remove rule for ${rule.displayName}`}
            disabled={isPending}
            onClick={() => remove(rule.id)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
