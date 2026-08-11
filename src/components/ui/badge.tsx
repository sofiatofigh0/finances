import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "caution" | "negative" | "accent";

const TONES: Record<Tone, string> = {
  neutral:
    "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]",
  positive: "bg-[var(--color-positive-soft)] text-[var(--color-positive)]",
  caution: "bg-[var(--color-caution-soft)] text-[var(--color-caution)]",
  negative: "bg-[var(--color-negative-soft)] text-[var(--color-negative)]",
  accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-tight",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
