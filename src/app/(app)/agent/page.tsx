import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { isAgentConfigured } from "@/lib/agent/run";
import { AgentChat } from "@/components/agent/agent-chat";
import type { ResultCard } from "@/lib/agent/types";

export const metadata: Metadata = { title: "Agent" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();

  // Continue the most recent conversation rather than starting cold each time.
  const { data: thread } = await supabase
    .from("spendable_agent_threads")
    .select("id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: messages } = thread
    ? await supabase
        .from("spendable_agent_messages")
        .select("id, role, content, result_cards")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true })
        .limit(50)
    : { data: [] };

  return (
    <Suspense fallback={null}>
      <AgentChat
        threadId={(thread?.id as string) ?? null}
        setupRequired={!isAgentConfigured()}
        initialMessages={(messages ?? []).map((m) => ({
          id: m.id as string,
          role: m.role as "user" | "assistant",
          content: m.content as string,
          cards: (m.result_cards ?? []) as ResultCard[],
        }))}
      />
    </Suspense>
  );
}
