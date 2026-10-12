import { keplerBridgeHub } from "@/lib/kepler/bridge-hub";
import { keplerCommandResultSchema, type KeplerCommand } from "@/lib/kepler/bridge-protocol";

const KEEPALIVE_MS = 15_000;

/** Event stream a map tab keeps open to receive commands from the kepler MCP server. */
export async function GET(req: Request) {
  const session = new URL(req.url).searchParams.get("session");
  if (!session) return new Response("Missing session.", { status: 400 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const detach = keplerBridgeHub.attach(session, (command: KeplerCommand) =>
        write(`event: command\ndata: ${JSON.stringify(command)}\n\n`),
      );
      const keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);

      cleanup = () => {
        clearInterval(keepalive);
        detach();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
      write("event: ready\ndata: {}\n\n");
    },
    cancel: () => cleanup(),
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression from buffering the stream
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Result of a command, posted by the map tab that ran it. */
export async function POST(req: Request) {
  const parsed = keplerCommandResultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid command result.", { status: 400 });

  const accepted = keplerBridgeHub.complete(parsed.data);
  return new Response(null, { status: accepted ? 204 : 410 });
}
