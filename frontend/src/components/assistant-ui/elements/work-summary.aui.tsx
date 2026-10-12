"use client";

import {
  useAuiState,
  type MessagePrimitive,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { useEffect, useRef, useState, type FC, type ReactNode } from "react";

import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/elements/tool-group.aui";
import type { WorkTiming } from "@/lib/ai/usage";

type GroupPart = MessagePrimitive.GroupedParts.GroupPart;

/** MCP servers prefix their tools with the server name; the operator doesn't need it. */
const SERVER_PREFIX =
  /^(?:netops|kepler|ontology|tower|menara|weather|mlpredict|netintel)_/;

/** "search_sites" → "Search sites". */
const humanize = (name: string) => {
  const words = name.replace(SERVER_PREFIX, "").replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A tool call in words. MCP servers in search mode expose a generic pair (`netops_search_tools`,
 * `netops_call_tool {name: "search_sites"}`), so name the inner tool; its name may stream in after
 * its arguments, so until then name the server.
 */
function toolLabel(toolName: string, args: unknown) {
  if (toolName.endsWith("_search_tools")) return "Tool search";
  if (toolName.endsWith("_call_tool")) {
    const inner = (args as { name?: unknown } | undefined)?.name;
    if (typeof inner === "string") return humanize(inner);
    return `${humanize(toolName.slice(0, -"_call_tool".length))} data`;
  }
  return humanize(toolName);
}

/** What the agent is doing in one step, for the line shown while it works. */
function stepLabel(
  part: { type: string; toolName?: string; args?: unknown } | undefined,
) {
  if (!part || part.type === "reasoning") return "Thinking";
  if (part.type !== "tool-call" || !part.toolName) return "Working";
  if (part.toolName.endsWith("_search_tools")) return "Finding the right tool";
  return toolLabel(part.toolName, part.args);
}

const formatDuration = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const workTimingOf = (custom: Record<string, unknown> | undefined) =>
  custom?.workTiming as WorkTiming | undefined;

/** Measures a run this component saw from its start; undefined for runs loaded from history. */
function useLiveDuration(active: boolean) {
  const startedAt = useRef<number | undefined>(undefined);
  const [ms, setMs] = useState<number>();
  useEffect(() => {
    if (active) startedAt.current ??= Date.now();
    else if (startedAt.current !== undefined && ms === undefined)
      setMs(Date.now() - startedAt.current);
  }, [active, ms]);
  return ms;
}

/**
 * One run of the agent's reasoning and tool calls, folded into a single line so the answer
 * stays in view: "Working · Search sites…" while it runs, "Worked for 23s · 9 steps" after.
 * Expanding it lists every step. Cards and the answer's text render outside it.
 */
export const WorkSummary: FC<{ group: GroupPart; children?: ReactNode }> = ({
  group,
  children,
}) => {
  const lastIndex = group.indices.at(-1)!;
  // the group's own status reads "complete" in the gap between one step and the next; it is
  // still working while the message runs and nothing has come after it
  const active = useAuiState(
    (s) =>
      s.message.status?.type === "running" &&
      lastIndex === s.message.parts.length - 1,
  );
  const current = useAuiState((s) =>
    active ? stepLabel(s.message.parts[lastIndex]) : "",
  );
  const steps = useAuiState(
    (s) =>
      group.indices.filter((i) => s.message.parts[i]?.type === "tool-call")
        .length,
  );
  // a step waiting on the operator must not hide inside a closed summary
  const needsAction = useAuiState((s) =>
    group.indices.some(
      (i) => s.message.parts[i]?.status?.type === "requires-action",
    ),
  );
  const [open, setOpen] = useState(false);

  // from the server's timestamps, which are saved with the chat
  const savedMs = useAuiState((s) => {
    const timing = workTimingOf(s.message.metadata.custom);
    if (!timing) return undefined;
    let start: number | undefined;
    let end: number | undefined;
    for (const i of group.indices) {
      const part = s.message.parts[i];
      const t = part?.type === "tool-call" ? timing[part.toolCallId] : undefined;
      if (t?.startedAt !== undefined)
        start = Math.min(start ?? t.startedAt, t.startedAt);
      if (t?.endedAt !== undefined) end = Math.max(end ?? t.endedAt, t.endedAt);
    }
    return start !== undefined && end !== undefined ? end - start : undefined;
  });
  const liveMs = useLiveDuration(active);
  const ms = liveMs ?? savedMs;
  const seconds = ms === undefined ? undefined : Math.max(1, Math.round(ms / 1000));

  let label: string;
  if (active) {
    label = `Working · ${current}…`;
  } else if (steps === 0) {
    label = seconds ? `Thought for ${formatDuration(seconds)}` : "Thought";
  } else {
    label = [
      seconds ? `Worked for ${formatDuration(seconds)}` : "Worked",
      `${steps} ${steps === 1 ? "step" : "steps"}`,
    ].join(" · ");
  }

  return (
    <ToolGroupRoot
      variant="ghost"
      data-slot="aui_work-summary"
      open={open || needsAction}
      onOpenChange={setOpen}
    >
      <ToolGroupTrigger count={steps} active={active} label={label} />
      {/* reasoning reads as quiet notes between the tool rows */}
      <ToolGroupContent className="border-border ms-1.5 border-s ps-3 [&_.aui-md]:text-muted-foreground [&_.aui-md]:text-[13px] [&_.aui-md]:leading-relaxed">
        {children}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
};

/** A tool call inside the work summary: its name in words; expands to arguments and result. */
export const WorkStep: ToolCallMessagePartComponent = (props) => (
  <ToolFallback {...props} toolName={toolLabel(props.toolName, props.args)} />
);
