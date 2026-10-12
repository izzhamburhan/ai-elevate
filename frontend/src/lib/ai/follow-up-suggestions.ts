/**
 * Follow-up prompts offered under the answer once a turn finishes (the chip row above the
 * composer). The browser sends a short transcript to `/api/suggestions`, which asks the model
 * that wrote the last answer for the next questions an operator would ask.
 */
import type { SuggestionAdapter, ThreadMessage } from "@assistant-ui/react";
import { useSyncExternalStore } from "react";

import type { ChatMessageMetadata } from "@/lib/ai/usage";

/** Recent messages the model sees; older turns rarely change what comes next. */
const MAX_MESSAGES = 8;
/** Characters of one message in the transcript, so a long answer can't crowd out the rest. */
const MAX_MESSAGE_CHARS = 1500;
/** Characters of one tool call's arguments: enough to name the place, tower or incident. */
const MAX_ARGS_CHARS = 200;

export type SuggestionsRequestBody = {
  transcript: string;
  modelId?: string;
  /** Tools the last answer had; absent on answers saved before this was recorded. */
  toolNames?: string[];
};

export type SuggestionsResponseBody = {
  suggestions: string[];
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * One line per message. Tool calls are listed by name and arguments because the answer is
 * mostly a card: its text alone ("Here is the area.") says nothing about what was shown.
 */
function toTranscriptLine(message: ThreadMessage): string | null {
  const parts = message.content
    .map((part) => {
      if (part.type === "text") return part.text.trim();
      if (part.type === "tool-call") return `[${part.toolName} ${clip(part.argsText, MAX_ARGS_CHARS)}]`;
      return "";
    })
    .filter(Boolean);
  if (parts.length === 0) return null;
  return `${message.role}: ${clip(parts.join(" "), MAX_MESSAGE_CHARS)}`;
}

/**
 * The answer whose follow-ups are being written, so the chat can show placeholders under that
 * answer (and not under another chat's) until they arrive.
 */
let pendingMessageId: string | null = null;
const listeners = new Set<() => void>();

function setPending(messageId: string | null) {
  pendingMessageId = messageId;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Id of the answer whose follow-ups are still loading, if any. */
export function usePendingFollowUps() {
  return useSyncExternalStore(subscribe, () => pendingMessageId, () => null);
}

export const followUpSuggestionAdapter: SuggestionAdapter = {
  async generate({ messages, signal }) {
    // a failed or stopped answer gets a retry from the user, not follow-ups
    const last = messages.at(-1);
    if (last?.role !== "assistant" || last.status.type !== "complete") return [];

    const transcript = messages
      .slice(-MAX_MESSAGES)
      .map(toTranscriptLine)
      .filter((line) => line != null)
      .join("\n");
    if (!transcript) return [];

    const { modelId, toolNames } = last.metadata.custom as ChatMessageMetadata;

    setPending(last.id);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, modelId, toolNames } satisfies SuggestionsRequestBody),
        signal,
      });
      // no follow-ups is the right fallback: the answer is complete without them
      if (!res.ok) return [];
      const { suggestions }: SuggestionsResponseBody = await res.json();
      return suggestions.map((prompt) => ({ prompt }));
    } finally {
      // a newer answer may have started its own request meanwhile
      if (pendingMessageId === last.id) setPending(null);
    }
  },
};
