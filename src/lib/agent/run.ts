import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { logger, UserFacingError } from "@/lib/logger";
import type { FinancialContext } from "@/lib/finance/types";
import { SYSTEM_PROMPT } from "./system-prompt";
import { AGENT_TOOLS, executeTool } from "./tools";
import type { ResultCard } from "./types";

/**
 * The agent loop.
 *
 * A real tool-using loop against the Anthropic Messages API: the model asks for
 * data, we execute the corresponding deterministic tool, feed the result back,
 * and repeat until it produces a final answer. The user's financial data is
 * never dumped into the prompt — the model has to ask for exactly what it needs.
 */

const MAX_ITERATIONS = 8;

export class AgentNotConfiguredError extends UserFacingError {
  constructor() {
    super(
      "The agent isn't set up yet. Add ANTHROPIC_API_KEY to your environment to ask questions about your money. Everything else in Spendable works without it.",
      503,
    );
    this.name = "AgentNotConfiguredError";
  }
}

export function isAgentConfigured(): boolean {
  return Boolean(serverEnv.anthropicApiKey);
}

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "card"; card: ResultCard }
  | { type: "done"; text: string; cards: ResultCard[] }
  | { type: "error"; message: string };

export interface AgentTurnInput {
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  context: FinancialContext;
}

/**
 * Runs one turn and yields events as they happen, so the UI can stream.
 */
export async function* runAgentTurn(
  input: AgentTurnInput,
): AsyncGenerator<AgentEvent> {
  if (!isAgentConfigured()) {
    yield { type: "error", message: new AgentNotConfiguredError().message };
    return;
  }

  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  const model = serverEnv.anthropicModel;

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({
      role: m.role,
      content: m.content,
    })) as Anthropic.MessageParam[],
    { role: "user", content: input.message },
  ];

  const cards: ResultCard[] = [];
  let finalText = "";

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const stream = client.messages.stream({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
        // Keep the assistant responsive; the heavy lifting is deterministic
        // code, not model reasoning.
        output_config: { effort: "medium" },
      });

      let turnText = "";
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          turnText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        }
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          yield { type: "tool_start", name: event.content_block.name };
        }
      }

      const response = await stream.finalMessage();

      if (response.stop_reason !== "tool_use") {
        finalText = turnText || textFrom(response);
        break;
      }

      // Echo the assistant turn back verbatim, including tool_use blocks.
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        try {
          const result = await executeTool(
            toolUse.name,
            toolUse.input,
            input.context,
          );
          if (result.card) {
            cards.push(result.card);
            yield { type: "card", card: result.card };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result.output),
          });
        } catch (error) {
          logger.error("agent.tool_failed", {
            tool: toolUse.name,
            message: error instanceof Error ? error.message : "unknown",
          });
          // Return the failure to the model so it can adapt rather than stall.
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              error: "That data could not be loaded right now.",
            }),
            is_error: true,
          });
        }
      }

      // All results for a turn go back in a single user message.
      messages.push({ role: "user", content: toolResults });
      finalText = turnText;
    }

    yield { type: "done", text: finalText, cards };
  } catch (error) {
    logger.error("agent.turn_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    yield {
      type: "error",
      message:
        "I couldn't finish that just now. Your financial data is unaffected — please try again.",
    };
  }
}

function textFrom(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
