/**
 * Chat model catalog, shared by the client (model picker) and the server (provider lookup).
 * Keep this file free of secrets — it is bundled into the browser.
 *
 * `id` is what the picker sends to the backend as `config.modelName`; the part before the
 * slash picks the provider in `lib/ai/providers.ts`.
 */
export type ChatModelProvider = "deepseek" | "openai" | "gigx" | "local";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
  provider: ChatModelProvider;
  /** Max tokens the model accepts per request (prompt + tools + history); drives the context meter. */
  contextWindow: number;
};

export const CHAT_MODELS: readonly ChatModel[] = [
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "DeepSeek API · fast",
    provider: "deepseek",
    contextWindow: 1_000_000,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "DeepSeek API · most capable",
    provider: "deepseek",
    contextWindow: 1_000_000,
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    description: "OpenAI API · balanced",
    provider: "openai",
    contextWindow: 1_050_000,
  },
  {
    // served by vLLM as google/gemma-4-E2B-it; the model's native window is 128k, but the GigX
    // deployment enforces max_model_len 16384 and answers anything past it with an opaque 400.
    // If the deployment changes, override with GIGX_CONTEXT_WINDOW on the server.
    id: "gigx/gemma-4-e2b-it",
    name: "Gemma 4 E2B",
    description: "GigX (nexa-dev) · google/gemma-4-E2B-it",
    provider: "gigx",
    contextWindow: 16_384,
  },
  {
    // the actual local model tag comes from LOCAL_LLM_MODEL on the server; the server may
    // override this window with LOCAL_LLM_CONTEXT_WINDOW (e.g. Ollama's num_ctx)
    id: "local/gemma4",
    name: "Gemma 4 (local)",
    description: "Ollama / OpenAI-compatible server",
    provider: "local",
    contextWindow: 128_000,
  },
];

export const DEFAULT_CHAT_MODEL_ID = "openai/gpt-6.1-sol";

export function findChatModel(id: string | undefined): ChatModel | undefined {
  return CHAT_MODELS.find((m) => m.id === id);
}
