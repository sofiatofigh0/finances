"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Sync now". The user should never have to wait for the scheduled job when
 * they want fresh numbers.
 */
export function SyncButton({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/plaid/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "We couldn't refresh right now.");
      } else if (data.itemCount === 0) {
        setMessage("No connected institutions to refresh yet.");
      } else if (data.failed > 0) {
        setMessage("Some accounts need attention — check Accounts.");
      }
      startTransition(() => router.refresh());
    } catch {
      setMessage("We couldn't reach the server. Your data is unchanged.");
    } finally {
      setSyncing(false);
    }
  }

  const busy = syncing || isPending;

  return (
    <div className="flex items-center gap-2">
      {message ? (
        <span className="max-w-[42vw] truncate text-[11.5px] text-[var(--color-ink-faint)]">
          {message}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleSync}
        disabled={busy}
        aria-label="Refresh financial data"
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] disabled:opacity-60",
          label && "w-auto gap-2 px-3 text-[13px] font-medium",
          className,
        )}
      >
        <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        {label}
      </button>
    </div>
  );
}
