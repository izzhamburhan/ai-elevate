import { frontendTools, type FrontendTools } from "@assistant-ui/ai-sdk";
import { createAgentUIStreamResponse, type TextStreamPart, type ToolSet, type UIMessage } from "ai";

import { createElevateAgent } from "@/lib/ai/agent";
import { connectMcpTools } from "@/lib/ai/mcp";
import { mcpServerListSchema } from "@/lib/ai/mcp-config";
import { ModelConfigError, resolveChatModel } from "@/lib/ai/providers";
import { contextTokensOf, toTurnUsage, type ChatMessageMetadata } from "@/lib/ai/usage";
import { readTowerContext, TOWER_MEDIA_TYPE } from "@/lib/menara/tower-context";

export const maxDuration = 60;

/** Request body sent by assistant-ui's AssistantChatTransport. */
type ChatRequestBody = {
  messages: UIMessage[];
  system?: string;
  tools?: FrontendTools;
  config?: { modelName?: string };
  /** Servers enabled in the connectors dialog, sent by ChatProvider. */
  mcpServers?: unknown;
};

/** A tower picked on the map rides as a file part (a chip in the chat); the model gets its text. */
function withTowerContext(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) =>
    message.role === "user" && message.parts.some((p) => p.type === "file" && p.mediaType === TOWER_MEDIA_TYPE)
      ? {
          ...message,
          parts: message.parts.map((p) =>
            p.type === "file" && p.mediaType === TOWER_MEDIA_TYPE ? { type: "text" as const, text: readTowerContext(p.url) } : p,
          ),
        }
      : message,
  );
}

export async function POST(req: Request) {
  const { messages, system, tools, config, mcpServers }: ChatRequestBody = await req.json();

  const userServers = mcpServerListSchema.safeParse(mcpServers ?? []);
  if (!userServers.success) {
    return new Response("Invalid MCP connector configuration.", { status: 400 });
  }

  let resolved;
  try {
    resolved = resolveChatModel(config?.modelName);
  } catch (error) {
    if (error instanceof ModelConfigError) {
      // useChat surfaces the response text as the error message in the thread
      return new Response(error.message, { status: 400 });
    }
    throw error;
  }

  const mcp = await connectMcpTools(userServers.data);
  req.signal.addEventListener("abort", () => void mcp.close());

  try {
    const agent = createElevateAgent({
      model: resolved.model,
      system,
      tools: { ...frontendTools(tools ?? {}), ...mcp.tools },
    });

    // Usage rides on the assistant message so the client's context meter (and saved history) has it.
    let stepCount = 0;
    let contextTokens: number | undefined;
    const messageMetadata = ({ part }: { part: TextStreamPart<ToolSet> }): ChatMessageMetadata | undefined => {
      switch (part.type) {
        case "start":
          return { modelId: resolved.id, contextWindow: resolved.contextWindow };
        case "finish-step":
          stepCount += 1;
          contextTokens = contextTokensOf(part.usage) ?? contextTokens;
          return { contextTokens, stepCount };
        case "finish":
          return { contextTokens, stepCount, usage: toTurnUsage(part.totalUsage) };
      }
    };

    return await createAgentUIStreamResponse({
      agent,
      uiMessages: withTowerContext(messages),
      abortSignal: req.signal,
      messageMetadata,
      onFinish: () => mcp.close(),
      onError: (error) => {
        console.error("[chat]", error);
        return error instanceof Error ? error.message : "The model request failed.";
      },
    });
  } catch (error) {
    await mcp.close();
    throw error;
  }
}
