"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

/**
 * Email magic-link sign-in.
 *
 * The email Supabase sends also carries a six-digit code, and this form used to
 * accept it as a second route in. That route was removed: the token behind it
 * was consistently reported expired by the time it was typed, while the link
 * built on the same token worked, and an entry field that reliably fails is
 * worse than no entry field.
 *
 * Sessions persist across launches (Supabase stores them in cookies), so this
 * is a once-per-device step, not a once-per-launch one.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSendLink(event: React.FormEvent) {
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
      setStatus("idle");
      // Show what Supabase actually said. The rate limit in particular needs
      // naming: retrying is the one thing that makes it worse, so a vague
      // "try again in a moment" points the user at the wrong action.
      const isRateLimit =
        signInError.status === 429 || /rate limit/i.test(signInError.message);
      setError(
        isRateLimit
          ? "Too many sign-in emails. Wait a few minutes, then request exactly one."
          : `We couldn't send that email: ${signInError.message}`,
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
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
          The link works once and expires after an hour. Requesting another one
          cancels the previous link, so use the most recent email.
        </p>

        <Button
          variant="ghost"
          size="sm"
          className="mt-4 -ml-3"
          onClick={() => {
            setStatus("idle");
            setError(null);
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSendLink} noValidate>
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
