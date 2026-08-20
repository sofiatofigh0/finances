import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { loadFinancialContext } from "@/lib/db/context";
import { runPurchaseScenario } from "@/lib/finance/scenario";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: z.number().positive().max(10_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(140).optional(),
  classification: z.enum(["fun", "necessary", "fixed", "goals"]).optional(),
});

/**
 * The purchase simulator. Deterministic: the same inputs always give the same
 * verdict, and no language model is involved in producing it.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter an amount greater than zero." },
        { status: 400 },
      );
    }

    const context = await loadFinancialContext(user.id);
    const scenario = runPurchaseScenario(context, parsed.data);

    return NextResponse.json({ scenario });
  } catch (error) {
    logger.error("scenario.failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "We couldn't run that simulation right now." },
      { status: 500 },
    );
  }
}
