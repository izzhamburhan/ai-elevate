"use client";

import { createContext, useContext, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  AuiProvider,
  Suggestions,
  useAui,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";

import { ModelSelector } from "@/components/assistant-ui/elements/model-selector.aui";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { chatThreadListAdapter } from "@/components/chat/chat-history";
import { ContextMeter } from "@/components/chat/context-meter";
import { SituationBoard } from "@/components/chat/situation-board";
import { SelectionCard } from "@/components/chat/tower-card";
import { ChatToolCall } from "@/components/chat/tool-ui";
import { ConnectorsMenu } from "@/components/connectors/connectors-menu";
import { enabledConnectorRequests } from "@/components/connectors/connectors-store";
import { useAnswerOnMap } from "@/components/map/use-answer-on-map";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL_ID } from "@/lib/ai/models";
import { followupAdapter, setSuggestionModel } from "@/lib/ai/followups";
import { STARTER_PROMPTS } from "@/lib/ai/starter-prompts";

/**
 * Chat endpoint. Defaults to the Next.js agent route; point it at another backend
 * (e.g. FastAPI) that speaks the AI SDK UI message stream protocol to swap it out.
 */
const CHAT_API_URL = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "/api/chat";

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
  return useChatRuntime({ transport, adapters: { suggestion: followupAdapter } });
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
  const [modelId, setModelId] = useState(DEFAULT_CHAT_MODEL_ID);
  const model = useMemo(() => ({ modelId, setModelId }), [modelId]);
  setSuggestionModel(modelId);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
    <div className="mb-3 px-2">
      <p className="text-lg font-medium tracking-tight">Network operations</p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
        Start from a hotspot below, or ask anything. Answers show on the map.
      </p>
      <SituationBoard />
    </div>
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
  ToolFallback: ChatToolCall,
  ComposerActions,
  ComposerTrailing: ChatContextMeter,
};

/** Renders nothing; keeps the map in step with the conversation. */
function AnswerOnMap() {
  useAnswerOnMap();
  return null;
}

/** Chat panel rendered as a tab inside kepler.gl's side panel. */
export function AssistantPanel() {
  const aui = useAui({ suggestions: Suggestions(STARTER_PROMPTS) });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 font-sans text-foreground">
      <h2 className="truncate text-base font-bold tracking-tight">Assistant</h2>

      <AuiProvider value={aui}>
        <AnswerOnMap />
        <SelectionCard />
        <div className="-mx-4 min-h-0 flex-1">
          <Thread components={threadComponents} />
        </div>
      </AuiProvider>
    </div>
  );
}
