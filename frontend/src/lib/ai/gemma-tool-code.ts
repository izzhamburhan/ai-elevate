import type { LanguageModelMiddleware } from "ai";

/**
 * Gemma sometimes answers a tool request in its native Python style instead of the JSON
 * tool-call format the server's parser understands, so the call arrives as plain text:
 *
 *   tool_code
 *   print(get_admin_boundary(name='Cyberjaya', include_geometry=True))<unused88>
 *
 * or in Gemma 4's own call syntax, which the gateway's tool parser sometimes leaves in the text:
 *
 *   Tool call: netops_search_tools{query:<|"|>congested 4G sites<|"|>}<tool_call|>
 *
 * The call can also land in the reasoning instead of the answer, leaving the reply empty:
 *
 *   reasoning: import_tool_code print(netops_search_tools(query="congested 4G sites"))
 *
 * This middleware turns such text back into real tool calls. It only acts when the reply has
 * no structured tool calls and the text names a tool that was offered in the request; the
 * reasoning is only read when there is no answer text.
 * Generate-only: pair it with simulateStreamingMiddleware (the GigX gateway can't stream anyway).
 */
export function gemmaToolCodeMiddleware(): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();
      if (result.content.some((part) => part.type === "tool-call")) return result;

      const textOf = (type: "text" | "reasoning") =>
        result.content.flatMap((part) => (part.type === type ? [part.text] : [])).join("");
      const answer = textOf("text");
      const text = answer.trim() ? answer : textOf("reasoning");
      if (!TOOL_TEXT_MARKER.test(text)) return result;

      const tools = new Map(
        (params.tools ?? []).flatMap((tool) =>
          tool.type === "function"
            ? [[tool.name, Object.keys(schemaProperties(tool.inputSchema))] as const]
            : [],
        ),
      );
      const calls = parseToolCode(text, tools);
      if (calls.length === 0) return result;

      return {
        ...result,
        content: [
          ...result.content.filter((part) => part.type !== "text"),
          ...calls.map((call, index) => ({
            type: "tool-call" as const,
            toolCallId: `tool_code-${Date.now().toString(36)}-${index}`,
            toolName: call.name,
            input: JSON.stringify(call.args),
          })),
        ],
        finishReason: { unified: "tool-calls", raw: result.finishReason.raw },
      };
    },
  };
}

function schemaProperties(schema: unknown): Record<string, unknown> {
  const properties = (schema as { properties?: unknown } | undefined)?.properties;
  return properties && typeof properties === "object" ? (properties as Record<string, unknown>) : {};
}

type ParsedCall = { name: string; args: Record<string, unknown> };

/** Text that announces a call: `tool_code`, Gemma 4's `<|tool_call>`/`<tool_call|>` tokens, or "Tool call:". */
const TOOL_TEXT_MARKER = /tool_code|tool_call|Tool call:/;

/** Gemma 4 delimits strings with this token instead of quotes; it becomes a quote char the parser knows. */
const GEMMA_QUOTE = "\u0001";

/**
 * Finds calls to known tools in the text after the marker: `tool(arg=value, ...)` (Python style) or
 * `tool{arg:value, ...}` (Gemma 4 style).
 */
export function parseToolCode(text: string, tools: ReadonlyMap<string, readonly string[]>): ParsedCall[] {
  const marker = TOOL_TEXT_MARKER.exec(text);
  const code = text
    .slice(marker ? marker.index + marker[0].length : 0)
    .replaceAll('<|"|>', GEMMA_QUOTE)
    .replace(/<[^<>\s]+>/g, "") // special tokens like <unused88>, <end_of_turn> or <tool_call|>
    .replace(/```/g, "");

  const calls: ParsedCall[] = [];
  const callStart = /\b([A-Za-z_]\w*)\s*([({])/g;
  let match: RegExpExecArray | null;
  while ((match = callStart.exec(code))) {
    const paramNames = tools.get(match[1]);
    if (!paramNames) continue; // e.g. the print( wrapper
    try {
      const parser = new PyParser(code, callStart.lastIndex);
      const { positional, keyword } = parser.callArguments(match[2] === "(" ? ")" : "}");
      const args: Record<string, unknown> = {};
      positional.forEach((value, i) => {
        if (paramNames[i]) args[paramNames[i]] = value;
      });
      calls.push({ name: match[1], args: { ...args, ...keyword } });
      callStart.lastIndex = parser.pos;
    } catch {
      // not a parsable call; keep scanning
    }
  }
  return calls;
}

/** Just enough of Python's literal syntax for tool arguments. */
class PyParser {
  constructor(
    private readonly src: string,
    public pos: number,
  ) {}

  /** Parses `a, b=1, ...)` or `a:1, ...}` (the opening bracket already consumed). */
  callArguments(close: ")" | "}") {
    const positional: unknown[] = [];
    const keyword: Record<string, unknown> = {};
    this.space();
    while (this.peek() !== close) {
      const name = /^([A-Za-z_]\w*)\s*(=(?!=)|:)/.exec(this.src.slice(this.pos));
      if (name) {
        this.pos += name[0].length;
        keyword[name[1]] = this.value();
      } else {
        positional.push(this.value());
      }
      this.space();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== close) throw new Error(`expected , or ${close}`);
      this.space();
    }
    this.pos++;
    return { positional, keyword };
  }

  private value(): unknown {
    this.space();
    const ch = this.peek();
    if (ch === "'" || ch === '"' || ch === GEMMA_QUOTE) return this.string(ch);
    if (ch === "[" || ch === "(") return this.sequence(ch === "[" ? "]" : ")");
    if (ch === "{") return this.dict();
    const rest = this.src.slice(this.pos);
    const literal = /^(True|False|None|true|false|null)\b/.exec(rest);
    if (literal) {
      this.pos += literal[0].length;
      return { True: true, true: true, False: false, false: false }[literal[1]] ?? null;
    }
    const number = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(rest);
    if (number) {
      this.pos += number[0].length;
      return Number(number[0]);
    }
    throw new Error(`unexpected ${ch}`);
  }

  private string(quote: string): string {
    let out = "";
    this.pos++;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos++];
      if (ch === quote) return out;
      if (ch === "\\") {
        const next = this.src[this.pos++];
        out += { n: "\n", t: "\t", r: "\r" }[next] ?? next;
      } else {
        out += ch;
      }
    }
    throw new Error("unterminated string");
  }

  private sequence(close: string): unknown[] {
    const items: unknown[] = [];
    this.pos++;
    this.space();
    while (this.peek() !== close) {
      items.push(this.value());
      this.space();
      if (this.peek() === ",") this.pos++;
      this.space();
    }
    this.pos++;
    return items;
  }

  private dict(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.pos++;
    this.space();
    while (this.peek() !== "}") {
      // Gemma 4 style leaves keys bare: {technology:<|"|>4g<|"|>}
      const bare = /^[A-Za-z_]\w*(?=\s*:)/.exec(this.src.slice(this.pos));
      const key = bare ? ((this.pos += bare[0].length), bare[0]) : this.value();
      this.space();
      if (this.peek() !== ":") throw new Error("expected :");
      this.pos++;
      out[String(key)] = this.value();
      this.space();
      if (this.peek() === ",") this.pos++;
      this.space();
    }
    this.pos++;
    return out;
  }

  private peek() {
    if (this.pos >= this.src.length) throw new Error("unexpected end");
    return this.src[this.pos];
  }

  private space() {
    while (/\s/.test(this.src[this.pos] ?? "")) this.pos++;
  }
}
