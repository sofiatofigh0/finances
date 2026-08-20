import { redirect } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { DemoBanner } from "@/components/nav/demo-banner";
import { AutoSync } from "@/components/finance/auto-sync";
import {
  getSessionUser,
  isGuest,
  createServerSupabase,
} from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

/** How old the newest data may be before opening the app triggers a refresh. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already gates this, but a server-side check means a
  // misconfigured matcher can never leak a financial screen.
  let guest = false;
  let stale = false;

  if (publicEnv.supabaseUrl) {
    const user = await getSessionUser();
    if (!user) redirect("/login");
    guest = isGuest(user);

    if (!guest) {
      // The least recently synced connection decides. If any institution is
      // behind, a refresh is worth doing — and the sync it triggers also
      // re-runs recurring detection, so newly detected bills and income show
      // up without the user having to ask for them.
      const supabase = await createServerSupabase();
      const { data } = await supabase
        .from("spendable_plaid_items")
        .select("last_successful_sync_at")
        .eq("user_id", user.id)
        .in("status", ["active", "error"])
        .order("last_successful_sync_at", {
          ascending: true,
          nullsFirst: true,
        })
        .limit(1)
        .maybeSingle();

      if (data) {
        const syncedAt = data.last_successful_sync_at
          ? Date.parse(data.last_successful_sync_at as string)
          : 0;
        stale = Date.now() - syncedAt > STALE_AFTER_MS;
      }
    }
  }

  return (
    <AppShell>
      {guest ? <DemoBanner /> : null}
      {stale ? <AutoSync /> : null}
      {children}
    </AppShell>
  );
}
