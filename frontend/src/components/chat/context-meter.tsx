"use client";

import { useMemo } from "react";
import { ThreadListPrimitive, useAuiState, type ThreadMessage } from "@assistant-ui/react";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { findChatModel } from "@/lib/ai/models";
import { estimateTokens, type ChatMessageMetadata } from "@/lib/ai/usage";
import { cn } from "@/lib/utils";

const WARN_AT = 0.7;
const CRITICAL_AT = 0.9;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en");

const metadataOf = (message: ThreadMessage): ChatMessageMetadata | undefined =>
  message.role === "assistant" ? (message.metadata.custom as ChatMessageMetadata) : undefined;

type ContextStats = {
  /** Tokens the chat occupies now. */
  used: number;
  window: number;
  /** No reply reported usage (e.g. a local server without usage stats), so `used` is a guess. */
  estimated: boolean;
  /** Usage of the latest reply that reported any. */
  lastTurn?: ChatMessageMetadata;
  /** All tokens processed across the chat (each tool step re-reads the context, so this outgrows `used`). */
  processed: number;
  messageCount: number;
};

function computeStats(messages: readonly ThreadMessage[], modelId: string): ContextStats {
  const selectedWindow = findChatModel(modelId)?.contextWindow ?? 128_000;
  let processed = 0;
  let lastIndex = -1;
  let lastTurn: ChatMessageMetadata | undefined;

  messages.forEach((message, index) => {
    const meta = metadataOf(message);
    processed += meta?.usage?.totalTokens ?? 0;
    if (meta?.contextTokens !== undefined) {
      lastIndex = index;
      lastTurn = meta;
    }
  });

  // anything after the last measured reply (a just-sent message) hasn't been counted yet
  const unmeasured = messages
    .slice(lastIndex + 1)
    .reduce((sum, m) => sum + estimateTokens(JSON.stringify(m.content)), 0);

  // the server's window is authoritative (it knows env overrides) while the same model is selected
  const window =
    lastTurn?.contextWindow && lastTurn.modelId === modelId ? lastTurn.contextWindow : selectedWindow;

  return {
    used: (lastTurn?.contextTokens ?? 0) + unmeasured,
    window,
    estimated: !lastTurn && messages.length > 0,
    lastTurn,
    processed,
    messageCount: messages.length,
  };
}

function level(ratio: number) {
  if (ratio >= CRITICAL_AT) return "critical";
  if (ratio >= WARN_AT) return "warn";
  return "ok";
}

const levelColor = {
  ok: "text-chart-3",
  warn: "text-amber-500",
  critical: "text-destructive",
} as const;

function Ring({ ratio, className }: { ratio: number; className?: string }) {
  const r = 7;
  const circumference = 2 * Math.PI * r;
  // keep a sliver visible once anything is used so the ring never looks empty mid-chat
  const shown = ratio > 0 ? Math.max(ratio, 0.03) : 0;
  return (
    <svg viewBox="0 0 18 18" className={cn("size-4 -rotate-90", className)} aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-foreground/10" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(shown, 1))}
        className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
      />
    </svg>
  );
}

function Row({ label, value, indent }: { label: string; value: React.ReactNode; indent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[12px]">
      <span className={cn("text-muted-foreground", indent && "ps-3 text-[11px]")}>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** Composer indicator: how full the current chat's context window is, with a breakdown on click. */
export function ContextMeter({ modelId }: { modelId: string }) {
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const draft = useAuiState((s) => s.composer.text);
  const stats = useMemo(() => computeStats(messages, modelId), [messages, modelId]);

  const ratio = stats.window > 0 ? stats.used / stats.window : 0;
  const state = level(ratio);
  const percent = ratio * 100;
  const percentLabel = percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
  const draftTokens = draft.trim() ? estimateTokens(draft) : 0;
  const usage = stats.lastTurn?.usage;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Context used: ${percentLabel} of ${compact.format(stats.window)} tokens`}
          className={cn(
            "hover:bg-muted/70 flex h-7 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium tabular-nums transition-colors",
            state === "ok" ? "text-muted-foreground" : levelColor[state],
          )}
        >
          <Ring ratio={ratio} className={cn(levelColor[state], isRunning && "animate-pulse")} />
          {stats.used > 0 ? <span>{percentLabel}</span> : null}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" side="top" className="w-64 gap-2 p-3 font-sans">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-semibold">Context window</p>
          <p className={cn("text-[12px] font-medium tabular-nums", levelColor[state])}>{percentLabel}</p>
        </div>

        <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
          <div
            className={cn("h-full rounded-full bg-current transition-[width] duration-500", levelColor[state])}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>

        <p className="text-muted-foreground text-[12px] tabular-nums">
          {stats.estimated ? "≈ " : null}
          {exact.format(stats.used)} of {exact.format(stats.window)} tokens
        </p>

        {state !== "ok" ? (
          <div
            className={cn(
              "flex gap-2 rounded-md border px-2 py-1.5 text-[12px] leading-4",
              state === "critical"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            <span>
              {state === "critical"
                ? "Almost full. New requests may fail or lose earlier details."
                : "Getting full. Long chats get slower and less focused."}{" "}
              Start a new chat for a fresh context.
            </span>
          </div>
        ) : null}

        <div className="bg-border -mx-3 h-px" />

        <div className="flex flex-col gap-1">
          <Row label="Messages" value={stats.messageCount} />
          {usage ? (
            <>
              <Row label="Last reply · input" value={exact.format(usage.inputTokens ?? 0)} />
              {usage.cachedInputTokens ? (
                <Row indent label="cached" value={exact.format(usage.cachedInputTokens)} />
              ) : null}
              <Row label="Last reply · output" value={exact.format(usage.outputTokens ?? 0)} />
              {usage.reasoningTokens ? (
                <Row indent label="reasoning" value={exact.format(usage.reasoningTokens)} />
              ) : null}
              {stats.lastTurn?.stepCount && stats.lastTurn.stepCount > 1 ? (
                <Row label="Last reply · model calls" value={stats.lastTurn.stepCount} />
              ) : null}
            </>
          ) : null}
          {stats.processed > 0 ? <Row label="Processed in this chat" value={compact.format(stats.processed)} /> : null}
          {draftTokens > 0 ? <Row label="Draft adds" value={`≈ ${exact.format(draftTokens)}`} /> : null}
        </div>

        {stats.estimated ? (
          <p className="text-muted-foreground text-[11px] leading-4">
            This model didn&apos;t report token usage, so the count is estimated from message length.
          </p>
        ) : stats.used === 0 ? (
          <p className="text-muted-foreground text-[11px] leading-4">
            Includes the system prompt, tool definitions and every message. Measured after the first reply.
          </p>
        ) : null}

        {stats.messageCount > 0 ? (
          <ThreadListPrimitive.New asChild>
            <Button variant="outline" size="sm" className="mt-1 h-7 text-[12px]">
              <PlusIcon />
              New chat
            </Button>
          </ThreadListPrimitive.New>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
