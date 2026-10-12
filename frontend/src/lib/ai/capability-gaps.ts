/**
 * Questions the assistant couldn't answer, kept to decide which tools to build next. The agent
 * calls `report_capability_gap` when it has to say it lacks a tool or data, and each call adds one
 * JSON line to the log (`npm run gaps` ranks them). Server only.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { findBuiltinConnectorByUrl } from "@/lib/ai/mcp-catalog";

export const CAPABILITY_GAP_TOOL = "report_capability_gap";

/** One JSON object per line; override with CAPABILITY_GAPS_LOG. */
export const CAPABILITY_GAPS_LOG = process.env.CAPABILITY_GAPS_LOG ?? path.join(process.cwd(), ".data", "capability-gaps.jsonl");

export type CapabilityGap = {
  at: string;
  modelId: string;
  /** The operator's question, in their words. */
  request: string;
  /** The tool or data that would have answered it. */
  needed: string;
  kind: "no_tool" | "no_data" | "tool_failed";
  /**
   * Connectors that were enabled but couldn't be reached this turn: a gap logged while the
   * server that has the tool was down is an ops problem, not a missing tool.
   */
  offline: string[];
};

/** The reporting tool for one chat turn; `offlineUrls` are the MCP servers that failed to connect. */
export function capabilityGapTool({ modelId, offlineUrls }: { modelId: string; offlineUrls: string[] }) {
  return tool({
    description:
      "Record that the operator asked for something you cannot answer with the tools or data you have. " +
      "Call it once, before you tell them, whenever you would say a tool, data source or capability is missing, " +
      "unavailable or failed. Only for a specific request, not a general question about what you can do. " +
      "It is only a note for the team that builds your tools: it answers nothing, and the operator needn't hear about it.",
    inputSchema: z.object({
      request: z.string().max(300).describe("The operator's question, briefly, in their words."),
      needed: z
        .string()
        .max(200)
        .describe("The capability that would answer it, e.g. 'congestion forecast for a tower, next 6 hours'."),
      kind: z
        .enum(["no_tool", "no_data", "tool_failed"])
        .describe("no_tool: nothing you have does this; no_data: a tool exists but has no data for it; tool_failed: the tool errored."),
    }),
    execute: async ({ request, needed, kind }) => {
      const gap: CapabilityGap = {
        at: new Date().toISOString(),
        modelId,
        request,
        needed,
        kind,
        offline: offlineUrls.map((url) => findBuiltinConnectorByUrl(url)?.name ?? url),
      };
      try {
        await mkdir(path.dirname(CAPABILITY_GAPS_LOG), { recursive: true });
        await appendFile(CAPABILITY_GAPS_LOG, `${JSON.stringify(gap)}\n`);
      } catch (error) {
        // the note is for us; the answer must not fail because of it
        console.warn("[capability-gaps]", error);
      }
      return { recorded: true };
    },
  });
}
