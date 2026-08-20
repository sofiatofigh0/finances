import type { Metadata } from "next";
import { PlaidOAuthResume } from "@/components/finance/plaid-oauth-resume";

export const metadata: Metadata = { title: "Connecting" };

/**
 * Where an OAuth institution returns the browser after the user authenticates
 * at their bank. Registered with Plaid as the redirect URI.
 */
export default function PlaidOAuthPage() {
  return (
    <main className="safe-top flex min-h-dvh flex-col items-center justify-center px-6">
      <PlaidOAuthResume />
    </main>
  );
}
