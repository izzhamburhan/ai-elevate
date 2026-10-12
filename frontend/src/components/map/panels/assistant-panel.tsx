"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider, AuiConfig, Tools, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";

import { ModelSelector } from "@/components/assistant-ui/elements/model-selector.aui";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { chatThreadListAdapter } from "@/components/chat/chat-history";
import { ContextMeter } from "@/components/chat/context-meter";
import { menaraToolkit } from "@/components/chat/menara-toolkit";
import { ConnectorsMenu } from "@/components/connectors/connectors-menu";
import { enabledConnectorRequests } from "@/components/connectors/connectors-store";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL_ID } from "@/lib/ai/models";

/**
 * Chat endpoint. Defaults to the Next.js agent route; point it at another backend
 * (e.g. FastAPI) that speaks the AI SDK UI message stream protocol to swap it out.
 */
const CHAT_API_URL = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "/api/chat";

/** Chat tools whose results render as cards in the answer (Map & area, Self-heal). */
const toolsConfig = AuiConfig({ tools: Tools({ toolkit: menaraToolkit }) });

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
  return useChatRuntime({ transport });
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
  const [modelId, setModelId] = useState(landing.modelId ?? DEFAULT_CHAT_MODEL_ID);
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

function AssistantWelcome() {
  return (
    <p className="mb-4 px-2 text-[13px] leading-5 text-muted-foreground">
      Describe what you&apos;d like to map — e.g. “Show the 10 most populated cities as a
      heatmap”.
    </p>
  );
}

function ComposerActions() {
  return (
    <>
      <ConnectorsMenu />
      <ChatModelPicker />
    </>
  );
}

function ChatContextMeter() {
  const { modelId } = useSelectedModel();
  return <ContextMeter modelId={modelId} />;
}

const threadComponents = {
  Welcome: AssistantWelcome,
  ComposerActions,
  ComposerTrailing: ChatContextMeter,
};

/** Chat panel rendered as a tab inside kepler.gl's side panel. */
export function AssistantPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 font-sans text-foreground">
      <h2 className="truncate text-base font-bold tracking-tight">What will you map?</h2>

      <div className="-mx-4 min-h-0 flex-1">
        <Thread components={threadComponents} />
      </div>
    </div>
  );
}
