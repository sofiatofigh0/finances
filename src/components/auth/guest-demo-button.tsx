"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Public demo entry point.
 *
 * Signs the visitor in anonymously and seeds their account with the demo
 * dataset, so each person gets a private sandbox rather than a shared login
 * everyone can break. Guests are limited server-side: no institution can be
 * connected, and the assistant is capped.
 */
export function GuestDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInAnonymously();

    if (signInError) {
      setBusy(false);
      setError(
        signInError.message.toLowerCase().includes("disabled")
          ? "The demo is turned off right now."
          : `We couldn't start the demo: ${signInError.message}`,
      );
      return;
    }

    const response = await fetch("/api/demo/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seed" }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setBusy(false);
      setError(data.error ?? "We couldn't load the demo data.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="mt-5">
      <div className="mb-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
        <span className="text-[11.5px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
          or
        </span>
        <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={startDemo}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {busy ? "Setting up your demo…" : "Explore the demo"}
      </Button>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
        >
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
        No signup. You get a private sandbox filled with realistic sample data —
        nothing you do affects anyone else, and no real bank can be connected.
      </p>
    </div>
  );
}
