"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * Disconnects an institution. Deliberately explicit about what happens to the
 * user's history, because "disconnect" reasonably sounds like "delete".
 */
export function DisconnectButton({
  itemId,
  institutionName,
}: {
  itemId: string;
  institutionName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "We couldn't disconnect that institution.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Disconnect ${institutionName}`}
        onClick={() => setOpen(true)}
        className="flex size-9 items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-sunken)]"
      >
        <Unplug className="size-4" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={`Disconnect ${institutionName}?`}>
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Spendable will stop refreshing these accounts. Your existing
            transaction history stays exactly where it is — nothing is deleted,
            so your past months still calculate correctly.
          </p>

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            <Button variant="danger" onClick={disconnect} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it connected
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
