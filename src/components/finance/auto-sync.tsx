"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Don't re-sync more than once in this window, however much the user navigates. */
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const LAST_RUN_KEY = "spendable.autosync.at";

/**
 * Refreshes financial data when the app is opened and the data has gone stale.
 *
 * Webhooks and the hourly job keep things current in the background, but
 * neither helps the moment someone opens the app after a quiet stretch — they
 * would read yesterday's balances until they thought to pull to refresh. This
 * closes that gap, and because a sync also re-runs recurring detection, newly
 * detected bills and income appear without being asked for.
 *
 * Rendered only when the server has already judged the data stale, and
 * rate-limited per browser session so moving between tabs does not re-trigger
 * it. Failures are deliberately silent: this is a background nicety, and the
 * Sync button on Settings reports errors properly when someone asks explicitly.
 */
export function AutoSync() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let last = 0;
    try {
      last = Number(window.sessionStorage.getItem(LAST_RUN_KEY) ?? 0);
    } catch {
      // Storage can be unavailable; the server-side staleness check still
      // bounds how often this runs.
    }
    if (Date.now() - last < MIN_INTERVAL_MS) return;

    try {
      window.sessionStorage.setItem(LAST_RUN_KEY, String(Date.now()));
    } catch {
      // Not fatal — worst case it syncs again on the next navigation.
    }

    void (async () => {
      try {
        const response = await fetch("/api/plaid/sync", { method: "POST" });
        if (response.ok) router.refresh();
      } catch {
        // Offline or interrupted. Nothing to say; the data on screen is still
        // the last good data.
      }
    })();
  }, [router]);

  return null;
}
