import { generateText } from "ai";

import type { SuggestionsRequestBody, SuggestionsResponseBody } from "@/lib/ai/follow-up-suggestions";
import { findBuiltinConnector } from "@/lib/ai/mcp-catalog";
import { ModelConfigError, resolveChatModel } from "@/lib/ai/providers";

export const maxDuration = 30;

/** Chips offered under each answer. */
const SUGGESTION_COUNT = 3;
/** Longer than this and the chip stops reading as a one-tap next step. */
const MAX_SUGGESTION_CHARS = 90;

/** Tool lines in the prompt; more than any real session has, so a bad request can't bloat it. */
const MAX_TOOLS = 200;

/** Used for answers saved before the chat recorded which tools they had. */
const DEFAULT_CAPABILITIES = `towers, outages, floods, people and app usage in an area, self-healing, congestion, weather exposure,
crowd and failure forecasts`;

/**
 * What the assistant could use for the last answer. A server started with --search lists only
 * `<prefix>_search_tools` and `<prefix>_call_tool`, so it is described by its connector entry instead.
 */
function describeTools(toolNames: string[]): string {
  const lines = new Set<string>();
  for (const name of toolNames.slice(0, MAX_TOOLS)) {
    const prefix = /^(.+)_(?:search_tools|call_tool)$/.exec(name)?.[1];
    if (!prefix) {
      lines.add(`- ${name}`);
      continue;
    }
    const connector = findBuiltinConnector(`builtin:${prefix}`) ?? findBuiltinConnector(`builtin:menara-${prefix}`);
    lines.add(connector ? `- ${connector.name}: ${connector.description}` : `- ${prefix} (searchable tool set)`);
  }
  return [...lines].join("\n");
}

function instructions(toolNames: string[] | undefined): string {
  const capabilities = toolNames?.length
    ? `The assistant can only answer with these tools and tool sets, nothing else:
${describeTools(toolNames)}

- Only suggest a question one of these tools can answer. If none fits a direction, pick another direction.
- Never suggest asking again for something the assistant said it can't do or has no tool or data for.
- Never suggest approving, rejecting or signing an approval: only a person can, outside the chat.`
    : `It works with ${DEFAULT_CAPABILITIES}.

- Only suggest what the assistant can do on the map.`;

  return `You suggest the next questions for an operator using Elevate, a network-operations map assistant.
Read the conversation and write exactly ${SUGGESTION_COUNT} short follow-up prompts the operator would plausibly send next.

${capabilities}

Rules:
- Write in the operator's voice, as they would type it, in the language they use.
- Each prompt is one line, under 60 characters, with no numbering, bullets or quotes.
- Be specific: reuse the tower IDs, sites, places and incidents named in the conversation.
- Each prompt moves the work forward in a different way (dig deeper, act on it, look ahead or widen the area).
  Never repeat a question already asked.
- Lines in [brackets] in the conversation are tools the assistant already called.
- Return only the ${SUGGESTION_COUNT} prompts, one per line.`;
}

/** Strips the list markers and quotes models add despite being told not to. */
function parseSuggestions(text: string): string[] {
  return text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*•]|\d+[.)])\s*/, "")
        .replace(/^["'“]|["'”]$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && line.length <= MAX_SUGGESTION_CHARS)
    .slice(0, SUGGESTION_COUNT);
}

export async function POST(req: Request) {
  const { transcript, modelId, toolNames }: SuggestionsRequestBody = await req.json();
  if (!transcript?.trim()) return Response.json({ suggestions: [] } satisfies SuggestionsResponseBody);

  let resolved;
  try {
    resolved = resolveChatModel(modelId);
  } catch (error) {
    if (error instanceof ModelConfigError) return new Response(error.message, { status: 400 });
    throw error;
  }

  try {
    const { text } = await generateText({
      model: resolved.model,
      system: instructions(Array.isArray(toolNames) ? toolNames : undefined),
      prompt: `Conversation:\n${transcript}`,
      maxOutputTokens: 1024,
      // three short lines need no deliberation: thinking took DeepSeek V4 Pro ~17s and could
      // spend the whole token budget, leaving no text. Each provider reads only its own key.
      providerOptions: {
        deepseek: { thinking: { type: "disabled" } },
        openai: { reasoningEffort: "low" },
      },
      abortSignal: req.signal,
    });
    return Response.json({ suggestions: parseSuggestions(text) } satisfies SuggestionsResponseBody);
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[suggestions]", error);
    return new Response("Could not generate follow-up suggestions.", { status: 502 });
  }
}
