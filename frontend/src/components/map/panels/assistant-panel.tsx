"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";

import { ModelSelector } from "@/components/assistant-ui/elements/model-selector.aui";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { WorkStep, WorkSummary } from "@/components/assistant-ui/elements/work-summary.aui";
import { chatThreadListAdapter } from "@/components/chat/chat-history";
import { ContextMeter } from "@/components/chat/context-meter";
import { menaraToolkit } from "@/components/chat/menara-toolkit";
import { ConnectorsMenu } from "@/components/connectors/connectors-menu";
import { enabledConnectorRequests } from "@/components/connectors/connectors-store";
import { followUpSuggestionAdapter } from "@/lib/ai/follow-up-suggestions";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL_ID } from "@/lib/ai/models";
import { EXAMPLE_PROMPTS } from "@/lib/example-prompts";
import { weatherDemoChatModel } from "@/lib/weather/demo";
import { AttachBoundaryButton } from "../drawn-boundary-actions";

/**
 * Chat endpoint. Defaults to the Next.js agent route; point it at another backend
 * (e.g. FastAPI) that speaks the AI SDK UI message stream protocol to swap it out.
 */
const CHAT_API_URL = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "/api/chat";

/**
 * Chat tools whose results render as cards in the answer (Map & area, Self-heal), and the example
 * prompts an empty chat offers (the same ones as the landing page's Ask section).
 */
const toolsConfig = AuiConfig({
  tools: Tools({ toolkit: menaraToolkit }),
  suggestions: Suggestions([...EXAMPLE_PROMPTS]),
});

type ModelContextValue = {
  modelId: string;
  setModelId: (id: string) => void;
};

const ModelContext = createContext<ModelContextValue | null>(null);

/** Runtime for one chat; runs once per mounted thread, so each gets its own transport. */
function useChatThreadRuntime() {
  const [transport] = useState(
    () =>
      new AssistantChatTransport({
        api: CHAT_API_URL,
        // read on every send so connector toggles apply to the next message
        body: () => ({ mcpServers: enabledConnectorRequests() }),
      }),
  );
  // resume the answer once a chat tool that runs in the browser (the Map & area and Self-heal cards) has returned;
  // once the answer is done, offer follow-up prompts above the composer
  return useChatRuntime({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    adapters: { suggestion: followUpSuggestionAdapter },
  });
}

/**
 * Prompt and model handed over from the landing page as `/workspace?q=…&model=deepseek|openai|local`.
 * Read once on mount; this component only renders in the browser (kepler is loaded with ssr: false).
 */
function readLandingParams() {
  const params = new URLSearchParams(window.location.search);
  const provider = params.get("model");
  return {
    prompt: params.get("q")?.trim() || null,
    modelId: CHAT_MODELS.find((m) => m.provider === provider)?.id ?? null,
  };
}

/**
 * Holds the chats (saved in this browser, see `chat-history.tsx`) and the selected model above
 * kepler.gl so both survive switching side-panel tabs (kepler unmounts the inactive panel component).
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatThreadRuntime,
    adapter: chatThreadListAdapter,
  });
  const [landing] = useState(readLandingParams);
  const [modelId, setModelId] = useState(() => landing.modelId ?? weatherDemoChatModel(DEFAULT_CHAT_MODEL_ID));
  const model = useMemo(() => ({ modelId, setModelId }), [modelId]);

  // Put the landing page's prompt in the composer (not sent), then drop it from the URL.
  useEffect(() => {
    if (!landing.prompt) return;
    runtime.thread.composer.setText(landing.prompt);
    window.history.replaceState(null, "", window.location.pathname);
  }, [runtime, landing.prompt]);

  return (
    <AssistantRuntimeProvider runtime={runtime} config={toolsConfig}>
      <ModelContext.Provider value={model}>{children}</ModelContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function useSelectedModel() {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useSelectedModel must be used inside <ChatProvider>");
  return ctx;
}

/** Sends the chosen model to the backend as `config.modelName` on every request. */
function ChatModelPicker() {
  const { modelId, setModelId } = useSelectedModel();
  return (
    <ModelSelector
      models={CHAT_MODELS}
      value={modelId}
      onValueChange={setModelId}
      size="sm"
      variant="ghost"
    />
  );
}

/** Empty chat: headline and hint above the composer; the example prompts render below it. */
function AssistantWelcome() {
  return (
    <div className="mb-4 flex flex-col gap-1.5 px-2">
      <h2 className="text-2xl font-medium tracking-[-0.025em]">Where would you like to investigate?</h2>
      <p className="text-[13px] leading-5 text-muted-foreground">
        Ask in plain language about a tower, an outage, or weather impact. Live telemetry,
        insights, and field data appear on the map.
      </p>
    </div>
  );
}

function ComposerActions() {
  return (
    <>
      <ConnectorsMenu />
      <ChatModelPicker />
      <AttachBoundaryButton />
    </>
  );
}

function ChatContextMeter() {
  const { modelId } = useSelectedModel();
  return <ContextMeter modelId={modelId} />;
}

const threadComponents = {
  Welcome: AssistantWelcome,
  // fold each run of reasoning and tool calls into one "Worked for 23s · 4 steps" line
  ChainOfThought: WorkSummary,
  ToolFallback: WorkStep,
  ComposerActions,
  ComposerTrailing: ChatContextMeter,
};

/** Chat panel rendered as a tab inside kepler.gl's side panel. */
export function AssistantPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col font-sans text-foreground">
      {/* the headline lives in the thread's welcome, so it sits in the thread's column (also when
          the chat is full width) and gives way to the messages once the chat starts */}
      <div className="-mx-4 min-h-0 flex-1">
        <Thread components={threadComponents} />
      </div>
    </div>
  );
}
