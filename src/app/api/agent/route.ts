import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { loadFinancialContext } from "@/lib/db/context";
import { isAgentConfigured, runAgentTurn } from "@/lib/agent/run";
import type { ResultCard } from "@/lib/agent/types";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  message: z.string().min(1).max(2000),
  threadId: z.string().uuid().optional(),
});

/**
 * Agent endpoint. Streams newline-delimited JSON events so the chat can render
 * text as it arrives and drop in deterministic result cards mid-answer.
 *
 * The Anthropic call happens here, server-side — the API key never reaches the
 * browser, and the model receives no financial data until it calls a tool.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAgentConfigured()) {
    return NextResponse.json(
      {
        error:
          "The assistant isn't set up yet. Add ANTHROPIC_API_KEY to ask questions about your money — everything else in Spendable works without it.",
        setupRequired: true,
      },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  // Resolve or create the conversation thread.
  let threadId = parsed.data.threadId;
  if (!threadId) {
    const { data } = await supabase
      .from("spendable_agent_threads")
      .insert({
        user_id: user.id,
        title: parsed.data.message.slice(0, 60),
      })
      .select("id")
      .single();
    threadId = data?.id;
  }

  if (!threadId) {
    return NextResponse.json(
      { error: "We couldn't start that conversation." },
      { status: 500 },
    );
  }

  // Load recent history for continuity, bounded so the prompt stays small.
  const { data: historyRows } = await supabase
    .from("spendable_agent_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(20);

  const history = (historyRows ?? []).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content as string,
  }));

  await supabase.from("spendable_agent_messages").insert({
    user_id: user.id,
    thread_id: threadId,
    role: "user",
    content: parsed.data.message,
  });

  const context = await loadFinancialContext(user.id, new Date(), supabase);

  const encoder = new TextEncoder();
  const resolvedThreadId = threadId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      send({ type: "thread", threadId: resolvedThreadId });

      let finalText = "";
      const cards: ResultCard[] = [];

      try {
        for await (const event of runAgentTurn({
          history,
          message: parsed.data.message,
          context,
        })) {
          if (event.type === "done") {
            finalText = event.text;
            cards.push(...event.cards);
          }
          if (event.type === "card") cards.push(event.card);
          send(event);
        }

        if (finalText.trim()) {
          await supabase.from("spendable_agent_messages").insert({
            user_id: user.id,
            thread_id: resolvedThreadId,
            role: "assistant",
            content: finalText,
            result_cards: cards,
          });
        }
      } catch (error) {
        logger.error("agent.stream_failed", {
          userId: user.id,
          message: error instanceof Error ? error.message : "unknown",
        });
        send({
          type: "error",
          message:
            "I couldn't finish that just now. Your financial data is unaffected.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
