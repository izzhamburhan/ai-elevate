"use client";

import { useEffect } from "react";

import type { KeplerCommand, KeplerCommandResult } from "@/lib/kepler/bridge-protocol";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { getKeplerSessionId } from "@/lib/kepler/session";

import type { makeKeplerStore } from "./kepler-store";

const BRIDGE_URL = "/api/kepler/bridge";

/**
 * Lets the kepler MCP server drive this map: receives commands over an event stream, runs them
 * against the kepler store and posts the results back. EventSource reconnects on its own.
 */
export function useKeplerBridge(store: ReturnType<typeof makeKeplerStore>, mapId: string) {
  useEffect(() => {
    const session = getKeplerSessionId();
    const events = new EventSource(`${BRIDGE_URL}?session=${encodeURIComponent(session)}`);

    events.addEventListener("command", async (event) => {
      const command = JSON.parse((event as MessageEvent<string>).data) as KeplerCommand;
      let result: KeplerCommandResult;
      try {
        const value = await runKeplerCommand(store, mapId, command.name, command.args);
        result = { id: command.id, session, ok: true, result: value };
      } catch (error) {
        console.warn(`[kepler-mcp] ${command.name} failed:`, error);
        result = { id: command.id, session, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      }).catch((error) => console.warn("[kepler-mcp] could not send result:", error));
    });

    return () => events.close();
  }, [store, mapId]);
}
