"use client";

import { AuiIf, useAuiState, ThreadPrimitive } from "@assistant-ui/react";
import type { FC } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { usePendingFollowUps } from "@/lib/ai/follow-up-suggestions";

const LABEL_CLASS = "px-2 pb-1 text-[11px] text-muted-foreground";

/** Placeholder rows while the model writes the follow-ups (a few seconds after the answer). */
const FollowupSuggestionsSkeleton: FC = () => (
  <div
    className="aui-thread-followup-suggestions-loading flex w-full flex-col"
    aria-busy
    aria-label="Loading follow-up questions"
  >
    <p className={LABEL_CLASS}>Ask next</p>
    {["w-3/4", "w-2/3", "w-1/2"].map((width) => (
      <div key={width} className="flex items-center gap-2.5 px-2 py-1.5">
        <Skeleton className="size-2.5 shrink-0 rounded-sm" />
        <Skeleton className={`h-[18px] ${width}`} />
      </div>
    ))}
  </div>
);

/**
 * Generated follow-ups, stacked like the empty chat's examples so each one wraps to the panel's
 * width and reads in full, instead of a row that scrolls sideways.
 */
const FollowupSuggestionsList: FC = () => {
  const suggestions = useAuiState((s) => s.thread.suggestions);

  return (
    <div className="aui-thread-followup-suggestions flex w-full flex-col">
      <p className={LABEL_CLASS}>Ask next</p>
      {suggestions.map((suggestion, idx) => (
        <ThreadPrimitive.Suggestion
          key={idx}
          prompt={suggestion.prompt}
          send
          style={{ animationDelay: `${idx * 50}ms` }}
          className="aui-thread-followup-suggestion group hover:bg-accent focus-visible:ring-ring/50 fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-start text-[13px] leading-snug transition-colors duration-200 outline-none focus-visible:ring-2 motion-reduce:animate-none motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="text-muted-foreground/60 group-hover:text-foreground font-mono text-xs transition-colors motion-reduce:transition-none"
          >
            {">"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground">
              {suggestion.title ?? suggestion.prompt}
            </span>
            {suggestion.label && (
              <span className="aui-thread-followup-suggestion-label text-muted-foreground ms-1">
                {suggestion.label}
              </span>
            )}
          </span>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
};

export const ThreadFollowupSuggestions: FC = () => {
  const pendingId = usePendingFollowUps();
  const lastId = useAuiState((s) => s.thread.messages.at(-1)?.id);
  const isLoading = pendingId != null && pendingId === lastId;

  return (
    <AuiIf condition={(s) => !s.thread.isEmpty && !s.thread.isRunning}>
      <AuiIf condition={(s) => s.thread.suggestions.length > 0}>
        <FollowupSuggestionsList />
      </AuiIf>
      <AuiIf condition={(s) => s.thread.suggestions.length === 0}>
        {isLoading ? <FollowupSuggestionsSkeleton /> : null}
      </AuiIf>
    </AuiIf>
  );
};
