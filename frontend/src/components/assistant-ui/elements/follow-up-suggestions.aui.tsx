"use client";

import { AuiIf, useAuiState, ThreadPrimitive } from "@assistant-ui/react";
import type { FC } from "react";

/**
 * Next-step chips under the last answer. A stacked list, not a sideways scroller: the chips are
 * specific (tower names, numbers), so they are long, and in the narrow side panel a scroller
 * would hide all but the first.
 */
const FollowupSuggestionsRow: FC = () => {
  const suggestions = useAuiState((s) => s.thread.suggestions);

  return (
    <div className="aui-thread-followup-suggestions flex w-full flex-col gap-1.5">
      {suggestions.map((suggestion, idx) => (
        <ThreadPrimitive.Suggestion
          key={idx}
          className="aui-thread-followup-suggestion border-foreground/10 hover:bg-foreground/[0.03] hover:border-foreground/25 focus-visible:ring-ring/50 flex w-full flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-start text-sm transition-colors ease-in outline-none focus-visible:ring-1 motion-reduce:transition-none"
          prompt={suggestion.prompt}
          send
        >
          <span className="text-foreground leading-snug font-medium">
            {suggestion.title ?? suggestion.prompt}
          </span>
          {suggestion.label && (
            <span className="aui-thread-followup-suggestion-label text-muted-foreground text-xs leading-snug">
              {suggestion.label}
            </span>
          )}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
};

export const ThreadFollowupSuggestions: FC = () => (
  <AuiIf
    condition={(s) =>
      !s.thread.isEmpty &&
      !s.thread.isRunning &&
      s.thread.suggestions.length > 0
    }
  >
    <FollowupSuggestionsRow />
  </AuiIf>
);
