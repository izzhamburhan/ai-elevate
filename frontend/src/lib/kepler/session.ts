"use client";

let sessionId: string | undefined;

/**
 * Identifies this tab's map to the kepler MCP server. The chat sends it with the kepler connector so
 * tool calls land on the map the user is looking at.
 */
export function getKeplerSessionId(): string {
  // randomUUID needs a secure context; plain-http LAN addresses don't have one
  sessionId ??=
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return sessionId;
}
