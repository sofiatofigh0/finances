"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  readLinkSession,
  clearLinkSession,
  exchangePublicToken,
} from "@/lib/plaid/link-storage";

/**
 * Resumes Link after an OAuth institution hands the browser back.
 *
 * The bank returns to this page rather than to wherever the user started, so
 * the flow has to be picked up from scratch: Link is re-created with the token
 * parked before the handoff, and told where the redirect landed via
 * `receivedRedirectUri` so it knows which attempt it is continuing.
 */
export function PlaidOAuthResume() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/accounts");
  const [error, setError] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);

  useEffect(() => {
    const session = readLinkSession();
    setReturnTo(session.returnTo);
    setRedirectUri(window.location.href);

    if (!session.token) {
      setError(
        "We lost track of this connection attempt. Start it again from Accounts.",
      );
      return;
    }
    setToken(session.token);
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      if (!publicToken) return;
      const result = await exchangePublicToken({
        publicToken,
        institutionId: metadata.institution?.institution_id ?? null,
        institutionName: metadata.institution?.name ?? null,
      });
      clearLinkSession();
      if (!result.ok) {
        setError(result.error ?? "We couldn't finish connecting.");
        return;
      }
      router.replace(returnTo);
      router.refresh();
    },
    [router, returnTo],
  );

  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: redirectUri ?? undefined,
    onSuccess,
    onExit: () => {
      clearLinkSession();
      router.replace(returnTo);
    },
  });

  useEffect(() => {
    if (token && redirectUri && ready) open();
  }, [token, redirectUri, ready, open]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--color-caution-soft)] text-[var(--color-caution)]">
          <TriangleAlert className="size-5" />
        </div>
        <h1 className="text-[17px] font-semibold tracking-tight">
          That connection didn&apos;t finish
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
          {error}
        </p>
        <Button className="mt-5 w-full" onClick={() => router.replace("/accounts")}>
          Back to accounts
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[14px] text-[var(--color-ink-muted)]">
      <Loader2 className="size-4 animate-spin" />
      Finishing your bank connection…
    </div>
  );
}
