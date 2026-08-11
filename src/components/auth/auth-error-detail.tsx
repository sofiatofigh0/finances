"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Shows why a sign-in link was rejected.
 *
 * The reason arrives one of two ways. The PKCE flow puts it in the query
 * string, where the callback route can read it and hand it on. The implicit
 * flow puts it in the URL fragment, which never leaves the browser — so that
 * one has to be read here, after mount.
 */
export function AuthErrorDetail() {
  const searchParams = useSearchParams();
  const [hashReason, setHashReason] = useState<{
    reason: string | null;
    detail: string | null;
  }>({ reason: null, detail: null });

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    setHashReason({
      reason: params.get("error_code") ?? params.get("error"),
      detail: params.get("error_description"),
    });
  }, []);

  const reason = searchParams.get("reason") ?? hashReason.reason;
  const detail = searchParams.get("detail") ?? hashReason.detail;

  if (!reason) return null;

  return (
    <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 text-left">
      <p className="text-[13px] font-semibold">{headline(reason)}</p>
      {detail ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
          {detail.replace(/\+/g, " ")}
        </p>
      ) : null}
      <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-faint)]">
        {reason}
      </p>
    </div>
  );
}

function headline(reason: string): string {
  switch (reason) {
    case "otp_expired":
      return "The link had already expired or been used.";
    case "access_denied":
      return "Supabase declined the sign-in.";
    case "missing_code":
      return "The link arrived without a sign-in code.";
    case "exchange_failed":
      return "The code couldn't be exchanged for a session.";
    case "validation_failed":
      return "The link was malformed.";
    default:
      return "Supabase rejected the sign-in.";
  }
}
