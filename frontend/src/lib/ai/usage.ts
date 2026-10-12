/**
 * Token accounting the chat route attaches to each assistant message (AI SDK `messageMetadata`),
 * read back by the context meter. Shared by server and client; keep it free of secrets.
 */
import type { LanguageModelUsage } from "ai";

export type TurnUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
};

export type ChatMessageMetadata = {
  modelId?: string;
  contextWindow?: number;
  /**
   * Tokens the conversation occupies after this message: the last step's prompt plus its output.
   * This is what the next request starts from (system prompt, tool definitions and history included).
   */
  contextTokens?: number;
  /** Everything this turn consumed across all tool-loop steps (what it cost, not what it holds). */
  usage?: TurnUsage;
  /**
   * Model calls made in this turn (each tool round trip is one step). Not `steps`: assistant-ui
   * reserves that metadata key for its own per-step array.
   */
  stepCount?: number;
  /**
   * Tools the agent had for this turn (browser tools plus the MCP servers that connected), so
   * follow-up suggestions only offer what the next turn can answer.
   */
  toolNames?: string[];
};

export function toTurnUsage(usage: LanguageModelUsage): TurnUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    totalTokens: usage.totalTokens,
  };
}

/** Context after a step: what was sent plus what came back (both are in the next request). */
export function contextTokensOf(usage: LanguageModelUsage): number | undefined {
  if (usage.inputTokens === undefined) return undefined;
  return usage.inputTokens + (usage.outputTokens ?? 0);
}

/** Rough count for text the model hasn't measured yet (~4 characters per token for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
