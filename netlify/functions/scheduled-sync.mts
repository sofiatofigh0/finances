import type { Config } from "@netlify/functions";

/**
 * Netlify Scheduled Function — periodic financial sync fallback.
 *
 * Plaid webhooks remain the primary, event-driven mechanism. This runs hourly
 * and only touches Plaid Items that have not synced recently, so it is a
 * reliability net rather than a polling loop. All work is delegated to the
 * Next.js route so there is exactly one implementation of sync logic.
 *
 * The schedule is declared both here and in netlify.toml; Netlify accepts
 * either, and keeping it in code means it travels with the function.
 */
export default async function handler() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL;
  const secret = process.env.SYNC_JOB_SECRET;

  if (!appUrl) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "scheduled_sync.missing_app_url",
        at: new Date().toISOString(),
      }),
    );
    return new Response("NEXT_PUBLIC_APP_URL is not set", { status: 500 });
  }

  if (!secret) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "scheduled_sync.missing_secret",
        at: new Date().toISOString(),
      }),
    );
    return new Response("SYNC_JOB_SECRET is not set", { status: 500 });
  }

  const started = Date.now();

  try {
    const response = await fetch(
      `${appUrl.replace(/\/$/, "")}/api/sync/run`,
      {
        method: "POST",
        headers: {
          "x-sync-secret": secret,
          "content-type": "application/json",
        },
      },
    );

    const body = await response.json().catch(() => ({}));

    console.log(
      JSON.stringify({
        level: response.ok ? "info" : "error",
        event: "scheduled_sync.complete",
        at: new Date().toISOString(),
        context: {
          status: response.status,
          durationMs: Date.now() - started,
          ...body,
        },
      }),
    );

    return new Response(JSON.stringify(body), {
      status: response.ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "scheduled_sync.failed",
        at: new Date().toISOString(),
        context: {
          message: error instanceof Error ? error.message : "unknown",
        },
      }),
    );
    return new Response("Sync failed", { status: 502 });
  }
}

export const config: Config = {
  // Hourly. Webhooks handle the fast path; this catches anything missed.
  schedule: "0 * * * *",
};
