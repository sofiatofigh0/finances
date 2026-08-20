import { cn } from "@/lib/utils";

export function Progress({
  value,
  tone = "accent",
  className,
}: {
  value: number;
  tone?: "accent" | "positive" | "caution";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const fill =
    tone === "positive"
      ? "var(--color-positive)"
      : tone === "caution"
        ? "var(--color-caution)"
        : "var(--color-ink)";

  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]",
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: fill }}
      />
    </div>
  );
}
