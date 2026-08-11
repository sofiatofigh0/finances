import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createLinkToken } from "@/lib/plaid/sync";
import { decryptToken } from "@/lib/security/crypto";
import { isPlaidConfigured, interpretPlaidError } from "@/lib/plaid/client";
import { serverEnv } from "@/lib/env";
import { logger, UserFacingError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Creates a Plaid Link token.
 *
 * Passing `itemId` puts Link into update mode, which is how a connection that
 * needs re-authentication is repaired without losing history.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isPlaidConfigured()) {
    return NextResponse.json(
      {
        error:
          "Plaid isn't connected yet. Add PLAID_CLIENT_ID and PLAID_SECRET to link accounts.",
        setupRequired: true,
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId : undefined;

    let accessToken: string | undefined;
    if (itemId) {
      // The token is read server-side only and never returned to the browser.
      const admin = createAdminSupabase();
      const { data } = await admin
        .from("spendable_plaid_items")
        .select("access_token_encrypted")
        .eq("id", itemId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (data?.access_token_encrypted && data.access_token_encrypted !== "revoked") {
        accessToken = decryptToken(data.access_token_encrypted);
      }
    }

    const linkToken = await createLinkToken(user.id, {
      accessToken,
      redirectUri: serverEnv.plaidRedirectUri,
    });

    return NextResponse.json({ linkToken });
  } catch (error) {
    if (error instanceof UserFacingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const interpreted = interpretPlaidError(error);
    logger.error("plaid.link_token.failed", {
      userId: user.id,
      errorCode: interpreted.errorCode,
    });
    return NextResponse.json({ error: interpreted.userMessage }, { status: 502 });
  }
}
