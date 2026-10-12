"use client";

import { useAuiState, type MessagePrimitive } from "@assistant-ui/react";
import type { FC, ReactNode } from "react";

import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/elements/tool-group.aui";

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
 * What the agent is doing in one step, in words. MCP servers expose a generic search/call pair
 * (`netops_search_tools`, `netops_call_tool {name: "search_sites"}`), so name the inner tool.
 */
function stepLabel(
  part: { type: string; toolName?: string; args?: unknown } | undefined,
) {
  if (!part || part.type === "reasoning") return "Thinking";
  if (part.type !== "tool-call" || !part.toolName) return "Working";
  if (part.toolName.endsWith("search_tools")) return "Finding the right tool";
  const inner = (part.args as { name?: unknown } | undefined)?.name;
  if (part.toolName.endsWith("call_tool") && typeof inner === "string")
    return humanize(inner);
  return humanize(part.toolName);
}

const formatDuration = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

/**
 * One run of the agent's reasoning and tool calls, folded into a single line so the answer
 * stays in view: "Working · Search sites…" while it runs, "Worked for 23s · 9 steps" after.
 * Expanding it shows every step. Cards and the answer's text render outside it.
 */
export const WorkSummary: FC<{ group: GroupPart; children: ReactNode }> = ({
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

  const { timing } = group;
  const seconds =
    timing?.completedAt === undefined
      ? undefined
      : Math.max(1, Math.round((timing.completedAt - timing.startedAt) / 1000));
  const stepText =
    steps > 0 ? `${steps} ${steps === 1 ? "step" : "steps"}` : undefined;

  let label: string;
  if (active) {
    label = `Working · ${current}…`;
  } else if (steps === 0) {
    label = seconds ? `Thought for ${formatDuration(seconds)}` : "Thought";
  } else {
    label = [
      seconds ? `Worked for ${formatDuration(seconds)}` : "Worked",
      stepText,
    ].join(" · ");
  }

  return (
    <ToolGroupRoot variant="ghost" data-slot="aui_work-summary">
      <ToolGroupTrigger count={steps} active={active} label={label} />
      <ToolGroupContent className="border-border ms-1.5 border-s ps-3">
        {children}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
};
