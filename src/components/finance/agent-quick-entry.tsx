"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wallet } from "lucide-react";
import { AffordCheck } from "./afford-check";

const CHIPS = [
  { label: "Can I afford something?", action: "afford" as const },
  { label: "How much this weekend?", prompt: "How much can I spend this weekend?" },
  { label: "Why did this change?", prompt: "Why did my safe-to-spend number change?" },
  { label: "Am I on track?", prompt: "Am I on track for my goals?" },
];

/** Bottom-of-Home entry point into the agent, plus the affordability flow. */
export function AgentQuickEntry() {
  const router = useRouter();
  const [affordOpen, setAffordOpen] = useState(false);
  const [value, setValue] = useState("");

  function ask(prompt: string) {
    router.push(`/agent?q=${encodeURIComponent(prompt)}`);
  }

  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) ask(value.trim());
          }}
          className="flex items-center gap-2"
        >
          <Sparkles className="ml-1 size-4 shrink-0 text-[var(--color-ink-faint)]" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask about my money…"
            aria-label="Ask the Spendable assistant"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] outline-none placeholder:text-[var(--color-ink-faint)]"
          />
          {value.trim() ? (
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-surface)]"
            >
              Ask
            </button>
          ) : null}
        </form>

        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() =>
                "action" in chip && chip.action === "afford"
                  ? setAffordOpen(true)
                  : ask(chip.prompt as string)
              }
              className="shrink-0 whitespace-nowrap rounded-full border border-[var(--color-border-subtle)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAffordOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--color-ink)] px-5 py-4 text-[15px] font-medium text-[var(--color-surface)] transition-opacity hover:opacity-90"
      >
        <Wallet className="size-4" />
        Can I afford this?
      </button>

      <AffordCheck open={affordOpen} onOpenChange={setAffordOpen} />
    </>
  );
}
