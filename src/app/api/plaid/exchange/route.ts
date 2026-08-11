import { NextResponse } from "next/server";
import { getSessionUser, isGuest } from "@/lib/supabase/server";
import {
  exchangePublicToken,
  getItemsForUser,
  syncItem,
} from "@/lib/plaid/sync";
import { interpretPlaidError } from "@/lib/plaid/client";
import { logger, UserFacingError } from "@/lib/logger";

export const dynamic = "force-dynamic";
// The first sync pulls ~6 months of history, so give it room.
export const maxDuration = 60;

/**
 * Exchanges the Link public token for an access token, stores it encrypted,
 * then performs the initial sync so the user sees real numbers immediately.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isGuest(user)) {
    return NextResponse.json(
      {
        error:
          "Connecting a real institution isn't available in the demo. Everything else works on the sample data.",
      },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const publicToken = body.publicToken;
    if (typeof publicToken !== "string" || !publicToken) {
      return NextResponse.json({ error: "Missing public token." }, { status: 400 });
    }

    const { itemRowId } = await exchangePublicToken(user.id, publicToken, {
      id: body.institutionId ?? null,
      name: body.institutionName ?? null,
    });

    const items = await getItemsForUser(user.id);
    const item = items.find((i) => i.id === itemRowId);

    if (item) {
      const result = await syncItem(item, "initial");
      return NextResponse.json({
        ok: true,
        itemId: itemRowId,
        added: result.added,
        status: result.status,
      });
    }

    return NextResponse.json({ ok: true, itemId: itemRowId });
  } catch (error) {
    if (error instanceof UserFacingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const interpreted = interpretPlaidError(error);
    logger.error("plaid.exchange.failed", {
      userId: user.id,
      errorCode: interpreted.errorCode,
    });
    return NextResponse.json(
      { error: "We couldn't finish connecting that institution." },
      { status: 502 },
    );
  }
}
