"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The full Plaid Link flow:
 *   tap Connect -> backend mints a link token -> Link opens -> success returns a
 *   public token -> backend exchanges it for an access token, encrypts it,
 *   stores the Item, and runs the initial sync -> UI refreshes.
 *
 * The access token never touches this component. Only the short-lived public
 * token does.
 */
export function PlaidLinkButton({
  itemId,
  label,
  variant = "primary",
  className,
}: {
  /** Present when repairing a connection: opens Link in update mode. */
  itemId?: string;
  label?: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "exchanging">("idle");
  const [error, setError] = useState<string | null>(null);

  const requestToken = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(
          data.code
            ? `${data.error ?? "We couldn't start the connection."} (${data.code})`
            : (data.error ?? "We couldn't start the connection."),
        );
        setStatus("idle");
        return;
      }
      setLinkToken(data.linkToken);
    } catch {
      setError("We couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }, [itemId]);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      if (!publicToken) return;
      setStatus("exchanging");
      try {
        const response = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution?.institution_id ?? null,
            institutionName: metadata.institution?.name ?? null,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "We couldn't finish connecting.");
        }
      } catch {
        setError("We couldn't finish connecting. Please try again.");
      } finally {
        setStatus("idle");
        setLinkToken(null);
        router.refresh();
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      setLinkToken(null);
      setStatus("idle");
    },
  });

  // Open Link as soon as the token is ready, so the user taps only once.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const busy = status !== "idle";

  return (
    <div className={className}>
      <Button
        variant={variant}
        onClick={requestToken}
        disabled={busy}
        className="w-full"
      >
        <Landmark className="size-4" />
        {status === "exchanging"
          ? "Importing your accounts…"
          : status === "loading"
            ? "Opening…"
            : (label ?? "Connect with Plaid")}
      </Button>
      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-negative)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
