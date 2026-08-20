import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/context";
import { getIntegrationStatus } from "@/lib/env";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const profile = await getProfile(supabase, user.id);
  const integrations = getIntegrationStatus();

  const [{ count: accountCount }, { data: candidates }] = await Promise.all([
    supabase
      .from("spendable_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("spendable_recurring_candidates")
      .select("id, display_name, average_amount, frequency")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("confidence", { ascending: false })
      .limit(5),
  ]);

  return (
    <OnboardingWizard
      plaidReady={integrations.plaid}
      hasAccounts={(accountCount ?? 0) > 0}
      alreadyComplete={Boolean(profile.onboarding_completed_at)}
      defaults={{
        cashBuffer: Number(profile.cash_buffer),
        necessaryAllowance: Number(profile.necessary_monthly_allowance),
      }}
      detected={(candidates ?? []).map((c) => ({
        id: c.id as string,
        name: c.display_name as string,
        amount: Number(c.average_amount),
        frequency: c.frequency as string,
      }))}
    />
  );
}
