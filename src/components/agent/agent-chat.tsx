"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Sparkles, Loader2 } from "lucide-react";
import type { ResultCard } from "@/lib/agent/types";
import type { PurchaseScenarioResult } from "@/lib/finance/scenario";
import { ScenarioResult } from "@/components/finance/afford-check";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: ResultCard[];
  streaming?: boolean;
}

const SUGGESTIONS = [
  "Can I spend $300 this weekend?",
  "What bills are coming up?",
  "Am I on track for my goals?",
  "Why did my safe-to-spend number change?",
];

/**
 * Mobile chat surface for the agent.
 *
 * Answers stream in, and deterministic result cards are rendered inline — the
 * scenario card the user sees is the engine's output, not the model's prose.
 */
export function AgentChat({
  initialMessages,
  threadId: initialThreadId,
  setupRequired,
}: {
  initialMessages: ChatMessage[];
  threadId: string | null;
  setupRequired: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toolName, setToolName] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  useEffect(scrollToBottom, [messages, toolName]);

  // A question handed over from Home (?q=...) is asked automatically, once.
  useEffect(() => {
    const question = searchParams.get("q");
    if (question && !sentInitial.current && !setupRequired) {
      sentInitial.current = true;
      void send(question);
      router.replace("/agent");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setupRequired]);

  async function send(message: string) {
    if (!message.trim() || busy) return;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      cards: [],
    };
    const assistantId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: "assistant", content: "", cards: [], streaming: true },
    ]);
    setInput("");
    setBusy(true);
    setToolName(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, threadId: threadId ?? undefined }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        patch(assistantId, {
          content:
            data.error ??
            "I couldn't answer that just now. Your financial data is unaffected.",
          streaming: false,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // The stream is newline-delimited JSON; partial lines are held over.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "thread" && typeof event.threadId === "string") {
            setThreadId(event.threadId);
          }
          if (event.type === "text_delta" && typeof event.text === "string") {
            setToolName(null);
            appendText(assistantId, event.text);
          }
          if (event.type === "tool_start" && typeof event.name === "string") {
            setToolName(event.name);
          }
          if (event.type === "card" && event.card) {
            addCard(assistantId, event.card as ResultCard);
          }
          if (event.type === "done") {
            patch(assistantId, { streaming: false });
          }
          if (event.type === "error" && typeof event.message === "string") {
            patch(assistantId, { content: event.message, streaming: false });
          }
        }
      }
    } catch {
      patch(assistantId, {
        content: "Something interrupted that answer. Please try again.",
        streaming: false,
      });
    } finally {
      setBusy(false);
      setToolName(null);
      patch(assistantId, { streaming: false });
    }
  }

  function patch(id: string, updates: Partial<ChatMessage>) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    );
  }

  function appendText(id: string, text: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)),
    );
  }

  function addCard(id: string, card: ResultCard) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, cards: [...m.cards, card] } : m)),
    );
  }

  if (setupRequired) {
    return (
      <div className="px-4 pt-3 md:px-6 md:pt-8">
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="The assistant isn't set up yet"
          description="Add ANTHROPIC_API_KEY to your environment to ask real questions about your money. Everything else in Spendable — Safe to Spend, the purchase simulator, goals — works without it."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 px-4 pt-3 md:px-6 md:pt-8">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Ask a real money question"
            description="The assistant reads your actual accounts through Spendable's financial engine. It explains the numbers — it never makes them up."
          />
        ) : (
          <ul className="flex flex-col gap-4 pb-4">
            {messages.map((message) => (
              <li key={message.id}>
                {message.role === "user" ? (
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-ink)] px-4 py-2.5 text-[14.5px] leading-relaxed text-[var(--color-surface)]">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {message.cards.map((card, index) => (
                      <AgentCard key={index} card={card} />
                    ))}
                    {message.content ? (
                      <div className="max-w-[92%] whitespace-pre-wrap text-[14.5px] leading-relaxed">
                        {message.content}
                      </div>
                    ) : message.streaming ? (
                      <div className="flex items-center gap-2 text-[13px] text-[var(--color-ink-faint)]">
                        <Loader2 className="size-3.5 animate-spin" />
                        {toolName
                          ? `Checking ${friendlyTool(toolName)}…`
                          : "Thinking…"}
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {messages.length === 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="rounded-full border border-[var(--color-border-subtle)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <div className="safe-bottom sticky bottom-[68px] z-30 border-t border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/95 px-4 py-3 backdrop-blur-lg md:bottom-0 md:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mx-auto flex max-w-2xl items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about my money…"
            aria-label="Message the assistant"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 leading-snug outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-[var(--color-surface)] transition-opacity disabled:opacity-35"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function friendlyTool(name: string): string {
  const map: Record<string, string> = {
    finance_get_snapshot: "your current position",
    finance_explain_safe_to_spend: "the safe-to-spend breakdown",
    finance_run_purchase_scenario: "the purchase simulator",
    finance_get_transactions: "your transactions",
    finance_get_upcoming_cashflows: "upcoming cash flow",
    finance_get_goals: "your goals",
    finance_get_recurring_expenses: "your regular expenses",
    finance_get_accounts: "your accounts",
    finance_run_extra_debt_payment: "an extra debt payment",
    finance_propose_classification_change: "a classification change",
  };
  return map[name] ?? "your finances";
}

/** Deterministic result cards rendered alongside the model's prose. */
function AgentCard({ card }: { card: ResultCard }) {
  if (card.type === "scenario") {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <ScenarioResult result={card.payload as PurchaseScenarioResult} />
      </div>
    );
  }

  if (card.type === "safe_to_spend") {
    const payload = card.payload as {
      result: { amount: number; limitingFactor: string };
    };
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
          Safe to spend
        </p>
        <p className="tnum mt-1 text-[28px] font-semibold tracking-tight">
          {formatMoney(payload.result.amount)}
        </p>
        <p className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">
          Limited by{" "}
          {payload.result.limitingFactor === "liquidity"
            ? "cash-flow timing"
            : "your monthly plan"}
        </p>
      </div>
    );
  }

  if (card.type === "proposal") {
    const payload = card.payload as {
      merchant_name: string | null;
      new_classification: string;
      scope: string;
    };
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4">
        <p className="text-[13px] font-semibold">Suggested change</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          Count {payload.merchant_name ?? "this merchant"} as{" "}
          <strong>{payload.new_classification}</strong>
          {payload.scope === "merchant" ? " for all future purchases" : ""}.
        </p>
        <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">
          Not applied. Open the transaction on the Activity tab to confirm it.
        </p>
      </div>
    );
  }

  return null;
}
