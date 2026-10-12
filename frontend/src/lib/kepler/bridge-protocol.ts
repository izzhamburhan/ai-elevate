import { z } from "zod";

/**
 * Wire format between the kepler MCP server (Next.js server) and the map running in the browser.
 *
 *   agent ── MCP ──▶ /api/kepler/mcp ── hub ──▶ SSE /api/kepler/bridge ──▶ browser (kepler store)
 *                                        ◀── POST /api/kepler/bridge ◀── command result
 *
 * The map lives in the browser's Redux store, so every tool call is forwarded to an open map tab,
 * run there, and its result sent back.
 */

/** Sent by the chat (through the connector's headers) so tools run on the map of that tab. */
export const KEPLER_SESSION_HEADER = "x-kepler-session";

export const KEPLER_COMMANDS = [
  "get_map_state",
  "get_dataset",
  "load_data",
  "remove_dataset",
  "add_layer",
  "update_layer",
  "remove_layer",
  "add_filter",
  "remove_filter",
  "set_view",
  "set_basemap",
  "split_map",
] as const;

export type KeplerCommandName = (typeof KEPLER_COMMANDS)[number];

export type KeplerCommand = { id: string; name: KeplerCommandName; args: Record<string, unknown> };

export const keplerCommandResultSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string(), session: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), session: z.string(), ok: z.literal(false), error: z.string() }),
]);

export type KeplerCommandResult = z.infer<typeof keplerCommandResultSchema>;
