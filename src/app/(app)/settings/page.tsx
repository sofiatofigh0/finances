import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/context";
import { getIntegrationStatus } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityForm } from "@/components/finance/entity-form";
import { MerchantRuleList } from "@/components/finance/merchant-rules";
import { DemoDataControls } from "@/components/finance/demo-controls";
import { updateProfile } from "@/app/actions/finance";
import { formatMoney, formatRelativeTime, CLASSIFICATION_LABELS } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const profile = await getProfile(supabase, user.id);
  const integrations = getIntegrationStatus();

  const [{ data: rules }, { data: syncRuns }, { data: items }] = await Promise.all([
    supabase
      .from("spendable_merchant_rules")
      .select("id, display_name, classification")
      .eq("user_id", user.id)
      .order("display_name"),
    supabase
      .from("spendable_sync_runs")
      .select("status, trigger, started_at, message")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("spendable_plaid_items")
      .select("id")
      .eq("user_id", user.id)
      .neq("status", "revoked"),
  ]);

  const lastSync = syncRuns?.[0];

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-8">
      <header className="safe-top mb-4">
        <h1 className="text-[19px] font-semibold tracking-tight">Settings</h1>
        <p className="truncate text-[12.5px] text-[var(--color-ink-faint)]">
          {user.email}
        </p>
      </header>

      {/* --------------------------- Spending plan ------------------------- */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>Your spending plan</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <EntityForm
            trigger={
              <SettingRow
                label="Minimum cash buffer"
                value={formatMoney(Number(profile.cash_buffer))}
                hint="Cash Safe-to-Spend will always preserve"
              />
            }
            title="Minimum cash buffer"
            description="This is not a savings goal. It's the minimum amount Spendable will never let your projected checking balance drop below."
            action={updateProfile}
            fields={[
              { kind: "money", name: "cash_buffer", label: "Always keep at least", defaultValue: Number(profile.cash_buffer) },
              { kind: "money", name: "necessary_monthly_allowance", label: "Monthly essentials allowance", defaultValue: Number(profile.necessary_monthly_allowance) },
              { kind: "number", name: "forecast_days", label: "Forecast horizon (days)", defaultValue: Number(profile.forecast_days) },
              { kind: "text", name: "display_name", label: "Your name", defaultValue: profile.display_name ?? "" },
            ]}
          />

          <EntityForm
            trigger={
              <SettingRow
                label="Essentials allowance"
                value={`${formatMoney(Number(profile.necessary_monthly_allowance))}/mo`}
                hint="Groceries, transport, pharmacy, household basics"
              />
            }
            title="Monthly essentials allowance"
            description="How much do you typically need for groceries, transportation, pharmacy, and household basics each month? Scheduled bills are tracked separately on the Plan tab."
            action={updateProfile}
            fields={[
              { kind: "money", name: "necessary_monthly_allowance", label: "Monthly allowance", defaultValue: Number(profile.necessary_monthly_allowance) },
              { kind: "money", name: "cash_buffer", label: "Minimum cash buffer", defaultValue: Number(profile.cash_buffer) },
              { kind: "number", name: "forecast_days", label: "Forecast horizon (days)", defaultValue: Number(profile.forecast_days) },
              { kind: "text", name: "display_name", label: "Your name", defaultValue: profile.display_name ?? "" },
            ]}
          />

          <SettingRow
            label="Forecast horizon"
            value={`${profile.forecast_days} days`}
            hint="How far ahead the liquidity guard looks"
          />
        </CardContent>
      </Card>

      {/* --------------------------- Accounts link ------------------------- */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>Accounts & institutions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Link href="/accounts" className="block">
            <SettingRow
              label="Manage accounts"
              value={`${items?.length ?? 0} connected`}
              hint="Connect, reconnect, add manual accounts and debts"
              chevron
            />
          </Link>
          <Link href="/plan" className="block">
            <SettingRow
              label="Regular expenses & income"
              value=""
              hint="Rent, bills, subscriptions, paychecks"
              chevron
            />
          </Link>
        </CardContent>
      </Card>

      {/* -------------------------- Merchant rules ------------------------- */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>Merchant rules</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(rules ?? []).length === 0 ? (
            <p className="py-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              None yet. When you reclassify a transaction you can choose to
              apply it to all future purchases from that merchant — those rules
              show up here and can be undone.
            </p>
          ) : (
            <MerchantRuleList
              rules={(rules ?? []).map((rule) => ({
                id: rule.id as string,
                displayName: rule.display_name as string,
                classification: CLASSIFICATION_LABELS[rule.classification as string],
              }))}
            />
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ Status ----------------------------- */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>Sync & integrations</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2 pb-3">
            <Badge tone={integrations.supabase ? "positive" : "caution"}>
              Supabase {integrations.supabase ? "connected" : "not set up"}
            </Badge>
            <Badge tone={integrations.plaid ? "positive" : "caution"}>
              Plaid {integrations.plaid ? "connected" : "not set up"}
            </Badge>
            <Badge tone={integrations.anthropic ? "positive" : "caution"}>
              Assistant {integrations.anthropic ? "ready" : "not set up"}
            </Badge>
            <Badge tone={integrations.encryption ? "positive" : "caution"}>
              Token encryption {integrations.encryption ? "on" : "not set up"}
            </Badge>
          </div>

          {lastSync ? (
            <SettingRow
              label="Last sync"
              value={formatRelativeTime(lastSync.started_at as string)}
              hint={
                lastSync.status === "success"
                  ? `Ran automatically (${lastSync.trigger})`
                  : ((lastSync.message as string) ??
                    "The last sync didn't complete. Your previous data is still available.")
              }
            />
          ) : (
            <SettingRow
              label="Last sync"
              value="Never"
              hint="Connect an institution to start syncing"
            />
          )}
        </CardContent>
      </Card>

      {/* ---------------------------- Demo data ---------------------------- */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>Demo data</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Load a realistic, clearly fake financial picture to explore every
            screen. Demo records are separate from anything synced from a real
            institution and can be removed in one tap.
          </p>
          <DemoDataControls isDemoMode={profile.demo_mode} />
        </CardContent>
      </Card>

      {/* ----------------------------- Privacy ----------------------------- */}
      <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-muted)]" />
        <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
          Financial data is used to calculate your personal spending plan and is
          not used to initiate transactions. Spendable can read and analyse your
          accounts — it can never move money, pay a bill, or open credit.
          Institution credentials are handled by Plaid and never reach
          Spendable; access tokens are encrypted before storage and never sent
          to your browser.
        </p>
      </div>

      <form action="/auth/signout" method="post" className="mb-6">
        <button
          type="submit"
          className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-3 text-[14px] font-medium text-[var(--color-negative)]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

function SettingRow({
  label,
  value,
  hint,
  chevron,
}: {
  label: string;
  value: string;
  hint?: string;
  chevron?: boolean;
}) {
  return (
    <span className="flex w-full cursor-pointer items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] py-3 text-left last:border-0">
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-ink-faint)]">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {value ? (
          <span className="tnum text-[13.5px] text-[var(--color-ink-muted)]">
            {value}
          </span>
        ) : null}
        {chevron ? (
          <ChevronRight className="size-4 text-[var(--color-ink-faint)]" />
        ) : null}
      </span>
    </span>
  );
}
