"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

/**
 * Email sign-in. Supabase sends one email containing both a magic link and a
 * six-digit code, and either one signs you in.
 *
 * The code matters more than it looks. Tapping the link opens the system
 * browser, but an installed home-screen app on iOS keeps its own cookie jar —
 * so a link tapped from Mail signs in Safari and leaves the installed app
 * logged out. Typing the code keeps the whole exchange inside whichever browser
 * the user is actually holding. It also survives mail scanners that follow
 * links automatically and burn the one-time token before the user taps it.
 *
 * Sessions persist across launches (Supabase stores them in cookies), so this
 * is a once-per-device step, not a once-per-launch one.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "verifying"
  >("idle");
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
      setError(
        "We couldn't send that email. Check the address and try again in a moment.",
      );
      return;
    }
    setStatus("sent");
  }

  async function handleVerifyCode(event: React.FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Enter the six-digit code from the email.");
      return;
    }

    setStatus("verifying");
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });

    if (verifyError) {
      setStatus("sent");
      setError(
        "That code didn't work. It expires after an hour and can only be used once — request a new one if you need to.",
      );
      return;
    }

    // The session now lives in cookies, so the server can see it too.
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  if (status === "sent" || status === "verifying") {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--color-positive-soft)] text-[var(--color-positive)]">
          <CheckCircle2 className="size-5" />
        </div>
        <h2 className="text-[15px] font-semibold">Check your email</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          We sent a sign-in email to <strong>{email}</strong>. Tap the link in
          it, or enter the six-digit code below if the email includes one.
        </p>

        <form onSubmit={handleVerifyCode} className="mt-4" noValidate>
          <Field label="Six-digit code">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={6}
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="tnum text-center text-[22px] tracking-[0.35em]"
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
            disabled={status === "verifying" || code.replace(/\D/g, "").length !== 6}
          >
            {status === "verifying" ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
          The same email also has a sign-in link. Use the code instead if you
          added Spendable to your home screen — a tapped link opens your browser,
          which signs in separately from the installed app.
        </p>

        <Button
          variant="ghost"
          size="sm"
          className="mt-3 -ml-3"
          onClick={() => {
            setStatus("idle");
            setCode("");
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
        hint="We'll email you a sign-in code. No password to remember."
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
        {status === "sending" ? "Sending…" : "Email me a sign-in code"}
      </Button>
    </form>
  );
}
