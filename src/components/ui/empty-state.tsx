import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
