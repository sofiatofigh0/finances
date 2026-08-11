import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { disconnectItem, type PlaidItemRow } from "@/lib/plaid/sync";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const itemId = typeof body.itemId === "string" ? body.itemId : null;
  if (!itemId) return NextResponse.json({ error: "Missing item." }, { status: 400 });

  const admin = createAdminSupabase();
  const { data } = await admin
    .from("spendable_plaid_items")
    .select(
      "id, user_id, plaid_item_id, access_token_encrypted, institution_name, transactions_cursor, status",
    )
    .eq("id", itemId)
    // Scoping by user_id is mandatory: the admin client bypasses RLS.
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    await disconnectItem(data as PlaidItemRow);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("plaid.disconnect.failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "We couldn't disconnect that institution." },
      { status: 502 },
    );
  }
}
