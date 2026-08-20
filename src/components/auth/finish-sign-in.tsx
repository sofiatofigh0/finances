"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Completes an implicit-flow sign-in.
 *
 * Supabase can return the session in the URL fragment, which browsers never
 * send to the server — so the callback route sees an empty query string and
 * hands off here. Fragments survive redirects, so the tokens are still present
 * by the time this mounts. Handing them to the browser client writes the
 * session to cookies, which is what makes the server recognise the user too.
 */
export function FinishSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const next = searchParams.get("next") ?? "/";
    const safeNext = next.startsWith("/") ? next : "/";

    const fail = (reason: string, detail?: string | null) => {
      const url = new URL("/auth/auth-code-error", window.location.origin);
      url.searchParams.set("reason", reason);
      if (detail) url.searchParams.set("detail", detail);
      router.replace(`${url.pathname}${url.search}`);
    };

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const hashError = hash.get("error_code") ?? hash.get("error");
    if (hashError) {
      fail(hashError, hash.get("error_description"));
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      fail("missing_code");
      return;
    }

    void (async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        fail("set_session_failed", error.message);
        return;
      }

      // Drop the tokens from the address bar before moving on.
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(safeNext);
      router.refresh();
    })();
  }, [router, searchParams]);

  return (
    <div className="flex items-center gap-2 text-[14px] text-[var(--color-ink-muted)]">
      <Loader2 className="size-4 animate-spin" />
      Signing you in…
    </div>
  );
}
