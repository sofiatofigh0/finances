"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

/**
 * Email magic-link sign-in. Sessions persist across launches (Supabase stores
 * them in cookies), so the installed PWA does not ask for a link every time.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");
    setError(null);

    const supabase = createClient();
    const redirectTo = `${publicEnv.appUrl.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (signInError) {
      setStatus("error");
      setError(
        "We couldn't send that link. Check the address and try again in a moment.",
      );
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--color-positive-soft)] text-[var(--color-positive)]">
          <CheckCircle2 className="size-5" />
        </div>
        <h2 className="text-[15px] font-semibold">Check your email</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          We sent a sign-in link to <strong>{email}</strong>. Open it on this
          device and you&apos;ll land straight in Spendable.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 -ml-3"
          onClick={() => setStatus("idle")}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Field
        label="Email address"
        hint="We'll email you a sign-in link. No password to remember."
      >
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={status === "sending" || !email.trim()}
      >
        <Mail className="size-4" />
        {status === "sending" ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
