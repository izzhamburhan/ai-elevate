/** Menara tools wrap their payload as `{ synthetic, as_of, data, evidence[], warnings[] }`. */
export type Envelope<T = unknown> = {
  synthetic?: boolean;
  as_of?: string;
  data: T;
  warnings?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An MCP tool result as the AI SDK hands it to the UI: `{ content: [{ type: "text", text }],
 * structuredContent? }`. Returns the JSON payload, or undefined when the result is not JSON
 * (still running, an error, or text from a server that does not return JSON).
 */
export function unwrapToolResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (result.isError) return undefined;
  if (result.structuredContent != null) return result.structuredContent;
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content.find((c) => isRecord(c) && c.type === "text" && typeof c.text === "string");
    if (isRecord(text)) {
      try {
        return JSON.parse(text.text as string);
      } catch {
        return undefined;
      }
    }
  }
  return result;
}

/** The `data` field of a Menara envelope, or undefined if the result has another shape. */
export function menaraData<T = Record<string, unknown>>(result: unknown): { data: T; warnings: string[] } | undefined {
  const payload = unwrapToolResult(result);
  if (!isRecord(payload) || !("data" in payload) || !isRecord(payload.data)) return undefined;
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter((w): w is string => typeof w === "string") : [];
  return { data: payload.data as T, warnings };
}
