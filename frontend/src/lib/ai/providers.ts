import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { DEFAULT_CHAT_MODEL_ID, findChatModel } from "./models";
import { configureLocalModel } from "./local-model";

// Server-only: reads API keys from the environment.

const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Ollama, LM Studio, vLLM and llama.cpp all expose an OpenAI-compatible /v1 endpoint.
const local = createOpenAICompatible({
  name: "local",
  baseURL: process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: process.env.LOCAL_LLM_API_KEY,
});

export class ModelConfigError extends Error {}

/** The local server's real window is a runtime setting (Ollama `num_ctx`), so it can be overridden. */
const localContextWindow = Number(process.env.LOCAL_LLM_CONTEXT_WINDOW) || undefined;

/** Resolves a picker id (`config.modelName`) to an AI SDK language model. */
export function resolveChatModel(modelId: string | undefined): {
  id: string;
  model: LanguageModel;
  contextWindow: number;
} {
  const entry = findChatModel(modelId) ?? findChatModel(DEFAULT_CHAT_MODEL_ID)!;
  const providerModelId = entry.id.slice(entry.id.indexOf("/") + 1);
  const { contextWindow } = entry;

  switch (entry.provider) {
    case "deepseek":
      if (!process.env.DEEPSEEK_API_KEY) {
        throw new ModelConfigError(
          "DEEPSEEK_API_KEY is not set. Add it to frontend/.env.local and restart the dev server.",
        );
      }
      return { id: entry.id, model: deepseek(providerModelId), contextWindow };
    case "openai":
      if (!process.env.OPENAI_API_KEY) {
        throw new ModelConfigError(
          "OPENAI_API_KEY is not set. Add it to frontend/.env.local and restart the dev server.",
        );
      }
      return { id: entry.id, model: openai(providerModelId), contextWindow };
    case "local":
      return {
        id: entry.id,
        model: configureLocalModel(
          local(process.env.LOCAL_LLM_MODEL ?? "gemma4:e4b"),
          process.env.LOCAL_LLM_REASONING_EFFORT,
        ),
        contextWindow: localContextWindow ?? contextWindow,
      };
  }
}
