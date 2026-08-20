import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { GuestDemoButton } from "@/components/auth/guest-demo-button";
import { getIntegrationStatus, publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  const status = getIntegrationStatus();

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-9">
          <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-[var(--color-ink)] text-xl font-bold text-[var(--color-surface)]">
            S
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
            Spendable
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
            Know what is actually safe to spend, after bills, debt, and goals.
          </p>
        </div>

        {status.supabase ? (
          // LoginForm reads ?next= from the URL, which is only known on the
          // client. Without this boundary the static prerender of /login fails.
          <>
            <Suspense fallback={<div className="min-h-[232px]" />}>
              <LoginForm />
            </Suspense>
            {publicEnv.guestDemoEnabled ? <GuestDemoButton /> : null}
          </>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[15px] font-semibold">Finish setup first</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Supabase isn&apos;t configured yet. Add{" "}
              <code className="rounded bg-[var(--color-surface-sunken)] px-1 py-0.5 text-[12px]">
                NEXT_PUBLIC_SUPABASE_URL
              </code>{" "}
              and{" "}
              <code className="rounded bg-[var(--color-surface-sunken)] px-1 py-0.5 text-[12px]">
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
              </code>{" "}
              to your environment, then reload. See the README for the exact
              steps.
            </p>
          </div>
        )}

        <p className="mt-8 text-center text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
          Spendable reads your financial data to calculate your personal
          spending plan. It never moves money.
        </p>
      </div>
    </main>
  );
}
