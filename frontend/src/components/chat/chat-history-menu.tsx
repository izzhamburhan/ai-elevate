"use client";

import { useState } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { HistoryIcon, MessageSquareIcon, SquarePenIcon, Trash2Icon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

function timeAgo(date: Date | undefined) {
  if (!date) return "";
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (minutes > -1) return "now";
  if (minutes > -60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (days > -7) return relative.format(days, "day");
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Starts a fresh chat; the current one stays in history. */
export function NewChatButton() {
  const isEmpty = useAuiState((s) => s.thread.messages.length === 0);
  return (
    <ThreadListPrimitive.New asChild>
      <TooltipIconButton
        tooltip="New chat"
        side="bottom"
        variant="ghost"
        disabled={isEmpty}
        className="text-muted-foreground hover:text-foreground size-7 p-1.5"
      >
        <SquarePenIcon className="size-4" />
      </TooltipIconButton>
    </ThreadListPrimitive.New>
  );
}

function ChatHistoryItem({ onSelect }: { onSelect: () => void }) {
  const lastMessageAt = useAuiState((s) => s.threadListItem.lastMessageAt);
  return (
    <ThreadListItemPrimitive.Root className="group hover:bg-muted/70 data-[active=true]:bg-muted flex items-center gap-1 rounded-md pe-1">
      <ThreadListItemPrimitive.Trigger
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <MessageSquareIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <ThreadListItemPrimitive.Title fallback="New chat" />
        </span>
        <span className="text-muted-foreground shrink-0 text-[11px] group-hover:hidden group-focus-within:hidden">
          {timeAgo(lastMessageAt)}
        </span>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete asChild>
        <TooltipIconButton
          tooltip="Delete chat"
          side="right"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive hidden size-6 shrink-0 p-1 group-hover:inline-flex group-focus-within:inline-flex"
        >
          <Trash2Icon className="size-3.5" />
        </TooltipIconButton>
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
}

/** Header button listing this browser's saved chats. */
export function ChatHistoryMenu() {
  const [open, setOpen] = useState(false);
  const count = useAuiState((s) => s.threads.threadIds.length);
  const isLoading = useAuiState((s) => s.threads.isLoading);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TooltipIconButton
          tooltip="Chat history"
          side="bottom"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground data-[state=open]:bg-muted size-7 p-1.5"
        >
          <HistoryIcon className="size-4" />
        </TooltipIconButton>
      </PopoverTrigger>

      <PopoverContent align="end" side="bottom" className="w-72 gap-1 p-1.5 font-sans">
        <div className="flex items-center justify-between px-2 pt-1 pb-1">
          <p className="text-muted-foreground text-xs font-medium">Chats</p>
          <ThreadListPrimitive.New
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <SquarePenIcon className="size-3.5" />
            New
          </ThreadListPrimitive.New>
        </div>

        <ThreadListPrimitive.Root className="flex max-h-80 flex-col overflow-y-auto">
          <ThreadListPrimitive.Items>{() => <ChatHistoryItem onSelect={() => setOpen(false)} />}</ThreadListPrimitive.Items>
        </ThreadListPrimitive.Root>

        {count === 0 ? (
          <p className="text-muted-foreground px-2 py-3 text-center text-[13px]">
            {isLoading ? "Loading…" : "No saved chats yet."}
          </p>
        ) : null}

        <p className="text-muted-foreground border-t px-2 pt-1.5 pb-0.5 text-[11px]">Saved in this browser only.</p>
      </PopoverContent>
    </Popover>
  );
}
