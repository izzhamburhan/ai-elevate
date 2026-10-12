import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { simulateStreamingMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Agent, fetch as undiciFetch } from "undici";

import { gemmaToolCodeMiddleware } from "./gemma-tool-code";
import { DEFAULT_CHAT_MODEL_ID, findChatModel } from "./models";
import { configureLocalModel } from "./local-model";

// Server-only: reads API keys from the environment.

const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

// GigX (TM nexa-dev) serves a self-signed *.nexa-dev.tm.com.my cert. Trust that one cert for
// this provider only, rather than disabling TLS verification process-wide.
const gigxCaPath =
  process.env.GIGX_CA_CERT ?? path.join(process.cwd(), "certs", "gigx-nexa-dev.pem");
// Read lazily so a missing cert only breaks GigX requests, not every model.
let gigxAgent: Agent | undefined;
const getGigxAgent = () =>
  (gigxAgent ??= new Agent({ connect: { ca: readFileSync(gigxCaPath, "utf8") } }));

const gigx = createOpenAICompatible({
  name: "gigx",
  baseURL: process.env.GIGX_BASE_URL ?? "https://gigx.nexa-dev.tm.com.my/llm/v1",
  apiKey: process.env.GIGX_API_KEY,
  // undici's Response type differs from the DOM lib's only in typings
  fetch: (url, init) =>
    undiciFetch(url as string, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: getGigxAgent(),
    }) as unknown as Promise<Response>,
  // The SDK sends `content: null` on tool-call-only assistant turns; the gateway's schema
  // validator rejects that with 400, which broke every request after a tool call.
  // Long tool results are cut down too: the deployment's 16k window can't hold one page of
  // NetOps rows (~50k chars), and overflowing it is another bare 400.
  transformRequestBody: (body) => ({
    ...body,
    messages: (body.messages as { role: string; content: unknown }[]).map((m) => {
      if (m.role === "assistant" && m.content == null) return { ...m, content: "" };
      if (m.role === "tool") return { ...m, content: truncateToolResult(m.content) };
      return m;
    }),
  }),
});

/** Characters of one tool result Gemma sees (about 2k tokens of JSON). */
const GIGX_TOOL_RESULT_CHARS = Number(process.env.GIGX_TOOL_RESULT_CHARS) || 6000;

function truncateToolResult(content: unknown): unknown {
  if (typeof content !== "string" || content.length <= GIGX_TOOL_RESULT_CHARS) return content;
  return (
    content.slice(0, GIGX_TOOL_RESULT_CHARS) +
    `\n…[truncated: showing the first ${GIGX_TOOL_RESULT_CHARS} of ${content.length} characters. ` +
    "Answer from what is shown, or call the tool again with a smaller page_size or a narrower filter.]"
  );
}

const gigxContextWindow = Number(process.env.GIGX_CONTEXT_WINDOW) || undefined;

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
    case "gigx":
      if (!process.env.GIGX_API_KEY) {
        throw new ModelConfigError(
          "GIGX_API_KEY is not set. Add it to frontend/.env.local and restart the dev server.",
        );
      }
      return {
        id: entry.id,
        // the gateway rejects `stream: true`, so make one generate call and replay it as a stream;
        // Gemma's text-form tool calls are recovered before the replay
        model: wrapLanguageModel({
          model: gigx(providerModelId),
          middleware: [simulateStreamingMiddleware(), gemmaToolCodeMiddleware()],
        }),
        contextWindow: gigxContextWindow ?? contextWindow,
      };
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
