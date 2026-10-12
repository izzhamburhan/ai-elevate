"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { BUILTIN_CONNECTORS, findBuiltinConnector } from "@/lib/ai/mcp-catalog";
import type { McpServerInspection, McpServerRequest } from "@/lib/ai/mcp-config";
import { KEPLER_SESSION_HEADER } from "@/lib/kepler/bridge-protocol";
import { getKeplerSessionId } from "@/lib/kepler/session";

export type ConnectorTransport = McpServerRequest["transport"];

/**
 * An MCP server shown in the connectors dialog: either built in (from `mcp-catalog.ts`) or
 * added by the user. Persisted in this browser's localStorage.
 */
export type Connector = {
  id: string;
  name: string;
  url: string;
  transport: ConnectorTransport;
  /** Sent as `Authorization: Bearer <token>`. */
  authToken?: string;
  /** Whether the chat may use this connector's tools. */
  enabled: boolean;
  disabledTools: string[];
  /** Built-in connectors can be switched off but not edited or removed. */
  builtin?: boolean;
};

/**
 * Puts the catalog's built-in connectors first, keeping the user's saved preferences for them
 * (on/off, disabled tools) while their name and URL always come from the catalog. Custom
 * connectors pointing at a built-in's URL are dropped as duplicates.
 */
function withBuiltins(saved: Connector[]): Connector[] {
  const builtins = BUILTIN_CONNECTORS.map((def): Connector => {
    const prev = saved.find((c) => c.id === def.id);
    return {
      id: def.id,
      name: def.name,
      url: def.url,
      transport: def.transport,
      builtin: true,
      enabled: prev?.enabled ?? true,
      disabledTools: prev?.disabledTools ?? [],
    };
  });
  const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
  const custom = saved.filter(
    (c) => !c.builtin && !BUILTIN_CONNECTORS.some((b) => b.id === c.id || sameUrl(b.url, c.url)),
  );
  return [...builtins, ...custom];
}

export type ConnectorStatus =
  | { state: "connecting" }
  | { state: "connected"; inspection: McpServerInspection }
  | { state: "error"; error: string };

export type NewConnector = Pick<Connector, "name" | "url" | "transport" | "authToken">;

type ConnectorsState = {
  connectors: Connector[];
  /** Live connection results; not persisted, refreshed when the dialog opens. */
  status: Record<string, ConnectorStatus>;
  add: (connector: NewConnector) => string;
  update: (id: string, patch: Partial<Omit<Connector, "id">>) => void;
  remove: (id: string) => void;
  toggleTool: (id: string, toolName: string, enabled: boolean) => void;
  setAllTools: (id: string, enabled: boolean) => void;
  refresh: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
};

function toRequest(c: Connector): McpServerRequest {
  const headers: Record<string, string> = {};
  if (c.authToken) headers.Authorization = `Bearer ${c.authToken}`;
  if (c.builtin && findBuiltinConnector(c.id)?.mapSession) headers[KEPLER_SESSION_HEADER] = getKeplerSessionId();
  return {
    // the chat route connects server-side, so app-relative URLs (built-ins served by this app) need the origin
    url: new URL(c.url, window.location.origin).href,
    transport: c.transport,
    headers: Object.keys(headers).length ? headers : undefined,
    disabledTools: c.disabledTools.length ? c.disabledTools : undefined,
  };
}

async function inspect(connector: Connector): Promise<McpServerInspection> {
  const res = await fetch("/api/mcp/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toRequest(connector)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as McpServerInspection;
}

export const useConnectors = create<ConnectorsState>()(
  persist(
    (set, get) => ({
      connectors: withBuiltins([]),
      status: {},

      add: (connector) => {
        const id = crypto.randomUUID();
        set((s) => ({
          connectors: [...s.connectors, { ...connector, id, enabled: true, disabledTools: [] }],
        }));
        void get().refresh(id);
        return id;
      },

      update: (id, patch) => {
        set((s) => ({
          connectors: s.connectors.map((c) =>
            c.id !== id
              ? c
              : // a built-in's identity comes from the catalog; only preferences change
                c.builtin
                ? { ...c, enabled: patch.enabled ?? c.enabled, disabledTools: patch.disabledTools ?? c.disabledTools }
                : { ...c, ...patch },
          ),
        }));
        if ("url" in patch || "transport" in patch || "authToken" in patch) void get().refresh(id);
      },

      remove: (id) =>
        set((s) => ({
          connectors: s.connectors.filter((c) => c.id !== id || c.builtin),
          status: Object.fromEntries(Object.entries(s.status).filter(([key]) => key !== id)),
        })),

      toggleTool: (id, toolName, enabled) =>
        set((s) => ({
          connectors: s.connectors.map((c) =>
            c.id !== id
              ? c
              : {
                  ...c,
                  disabledTools: enabled
                    ? c.disabledTools.filter((t) => t !== toolName)
                    : [...new Set([...c.disabledTools, toolName])],
                },
          ),
        })),

      setAllTools: (id, enabled) =>
        set((s) => ({
          connectors: s.connectors.map((c) => {
            if (c.id !== id) return c;
            const status = s.status[id];
            const all = status?.state === "connected" ? status.inspection.tools.map((t) => t.name) : [];
            return { ...c, disabledTools: enabled ? [] : all };
          }),
        })),

      refresh: async (id) => {
        const connector = get().connectors.find((c) => c.id === id);
        if (!connector) return;
        set((s) => ({ status: { ...s.status, [id]: { state: "connecting" } } }));
        let next: ConnectorStatus;
        try {
          next = { state: "connected", inspection: await inspect(connector) };
        } catch (error) {
          next = { state: "error", error: error instanceof Error ? error.message : String(error) };
        }
        // the connector may have been removed while we were waiting
        if (get().connectors.some((c) => c.id === id)) {
          set((s) => ({ status: { ...s.status, [id]: next } }));
        }
      },

      refreshAll: async () => {
        await Promise.all(get().connectors.map((c) => get().refresh(c.id)));
      },
    }),
    {
      name: "elevate-connectors",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ connectors: s.connectors }),
      merge: (persisted, current) => ({
        ...current,
        connectors: withBuiltins((persisted as { connectors?: Connector[] } | undefined)?.connectors ?? []),
      }),
    },
  ),
);

/** Enabled connectors in the shape the chat route expects as `mcpServers`. */
export function enabledConnectorRequests(): McpServerRequest[] {
  return useConnectors
    .getState()
    .connectors.filter((c) => c.enabled)
    .map(toRequest);
}
