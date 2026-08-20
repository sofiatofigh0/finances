"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DemoDataControls({ isDemoMode }: { isDemoMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"load" | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: "load" | "clear") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action === "clear" ? "clear" : "seed" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "That didn't work.");
        return;
      }
      setMessage(
        action === "clear"
          ? "Demo data removed."
          : `Loaded ${data.transactions} demo transactions.`,
      );
      router.refresh();
    } catch {
      setMessage("We couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() => run("load")}
          disabled={busy !== null}
          className="flex-1"
        >
          {busy === "load" ? "Loading…" : "Load demo data"}
        </Button>
        {isDemoMode ? (
          <Button
            variant="ghost"
            onClick={() => run("clear")}
            disabled={busy !== null}
            className="flex-1"
          >
            {busy === "clear" ? "Removing…" : "Remove demo data"}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="mt-2.5 text-[12.5px] text-[var(--color-ink-muted)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
