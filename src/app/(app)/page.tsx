import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, Landmark, TriangleAlert } from "lucide-react";
import { getSessionUser } from "@/lib/supabase/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadFinancialContext, getProfile } from "@/lib/db/context";
import { computeSafeToSpend, explainSafeToSpend } from "@/lib/finance/safe-to-spend";
import { computeAllGoalProgress } from "@/lib/finance/goals";
import { SafeToSpendHero } from "@/components/finance/safe-to-spend-hero";
import {
  GoalsPreview,
  QuickBreakdown,
  UpcomingEvents,
} from "@/components/finance/home-sections";
import { AgentQuickEntry } from "@/components/finance/agent-quick-entry";
import { SyncButton } from "@/components/finance/sync-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";

// Financial data must be computed per request, never cached between users.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const profile = await getProfile(supabase, user.id);

  // A brand-new account goes to onboarding rather than an empty dashboard.
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  const context = await loadFinancialContext(user.id, new Date(), supabase);
  const result = computeSafeToSpend(context);
  const explanation = explainSafeToSpend(result);
  const goals = computeAllGoalProgress(context.goals, context.asOf);

  const firstName = (profile.display_name ?? "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi, ${firstName}` : "Your money today";

  const { data: brokenItems } = await supabase
    .from("spendable_plaid_items")
    .select("id, institution_name, status")
    .eq("user_id", user.id)
    .eq("status", "needs_reauth");

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-8">
      <header className="safe-top mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* The sidebar already carries the brand on desktop, so the title
              gives way to the greeting rather than repeating it. */}
          <h1 className="text-[19px] font-semibold tracking-tight md:text-[24px]">
            <span className="md:hidden">Spendable</span>
            <span className="hidden md:inline">{greeting}</span>
          </h1>
          <p className="truncate text-[12px] text-[var(--color-ink-faint)] md:text-[13px]">
            Updated {formatRelativeTime(context.dataThrough)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SyncButton />
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex size-9 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] md:hidden"
          >
            <Settings className="size-[18px]" />
          </Link>
        </div>
      </header>

      {brokenItems && brokenItems.length > 0 ? (
        <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] bg-[var(--color-caution-soft)] px-4 py-3.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-caution)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-[var(--color-caution)]">
              {brokenItems[0].institution_name ?? "An institution"} needs
              attention
            </p>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">
              Sign in again to keep these balances current. Your history is
              safe.
            </p>
          </div>
          <Link
            href="/accounts"
            className="shrink-0 self-center rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-[12.5px] font-medium"
          >
            Reconnect
          </Link>
        </div>
      ) : null}

      {result.hasData ? (
        // One column on a phone. On a wide screen the answer and its
        // derivation stay together on the left, while what is coming up sits
        // alongside instead of below the fold.
        <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-5 lg:items-start lg:gap-4">
          <div className="flex flex-col gap-3.5 lg:col-span-3 lg:gap-4">
            <SafeToSpendHero result={result} explanation={explanation} />
            <QuickBreakdown plan={result.plan} />
          </div>
          <div className="flex flex-col gap-3.5 lg:col-span-2 lg:gap-4">
            <UpcomingEvents events={result.forecast.events} />
            <GoalsPreview goals={goals} />
            <AgentQuickEntry />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <EmptyState
            icon={<Landmark className="size-5" />}
            title="Connect your finances"
            description="Link checking and credit accounts so Spendable can calculate what is actually safe to spend. You can also add everything by hand."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild>
                  <Link href="/accounts">Connect an account</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href="/onboarding">Set things up</Link>
                </Button>
              </div>
            }
          />
          <AgentQuickEntry />
        </div>
      )}
    </div>
  );
}
