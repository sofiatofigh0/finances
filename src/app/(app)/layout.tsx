import { redirect } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { DemoBanner } from "@/components/nav/demo-banner";
import { getSessionUser, isGuest } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already gates this, but a server-side check means a
  // misconfigured matcher can never leak a financial screen.
  let guest = false;
  if (publicEnv.supabaseUrl) {
    const user = await getSessionUser();
    if (!user) redirect("/login");
    guest = isGuest(user);
  }

  return (
    <AppShell>
      {guest ? <DemoBanner /> : null}
      {children}
    </AppShell>
  );
}
