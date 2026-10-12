import type { KeplerCommand, KeplerCommandName, KeplerCommandResult } from "./bridge-protocol";

const COMMAND_TIMEOUT_MS = 20_000;

type MapTab = { send: (command: KeplerCommand) => void; attachedAt: number };

type Pending = {
  session: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Routes kepler MCP tool calls to the browser tabs that hold the map. In-memory, so it assumes a
 * single Next.js server process (dev server or one `next start` instance).
 */
class KeplerBridgeHub {
  private tabs = new Map<string, MapTab>();
  private pending = new Map<string, Pending>();

  /** Called when a map tab opens its event stream. Returns the detach function. */
  attach(session: string, send: MapTab["send"]): () => void {
    const tab: MapTab = { send, attachedAt: Date.now() };
    this.tabs.set(session, tab);
    return () => {
      // a reload can re-attach the same session before the old stream closes
      if (this.tabs.get(session) !== tab) return;
      this.tabs.delete(session);
      for (const [id, p] of this.pending) {
        if (p.session !== session) continue;
        this.settle(id, () => p.reject(new Error("The map tab was closed or reloaded.")));
      }
    };
  }

  /**
   * Runs a command on a map tab. With a session (sent by the chat) only that tab is used; without
   * one (an external MCP client such as Claude Code) the most recently opened tab is used.
   */
  run(session: string | undefined, name: KeplerCommandName, args: Record<string, unknown>) {
    const target = session ?? this.latestSession();
    const tab = target ? this.tabs.get(target) : undefined;
    if (!target || !tab) {
      return Promise.reject(
        new Error(
          session
            ? "The map this chat belongs to is not connected. Reload the map page and try again."
            : "No kepler.gl map is open. Open the Elevate map in a browser tab first.",
        ),
      );
    }

    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => this.settle(id, () => reject(new Error(`The map did not answer "${name}" in time.`))),
        COMMAND_TIMEOUT_MS,
      );
      this.pending.set(id, { session: target, resolve, reject, timer });
      try {
        tab.send({ id, name, args });
      } catch (error) {
        this.settle(id, () => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  /** Result posted back by the browser. Ignored if it timed out or came from another tab. */
  complete(result: KeplerCommandResult): boolean {
    const p = this.pending.get(result.id);
    if (!p || p.session !== result.session) return false;
    this.settle(result.id, () =>
      result.ok ? p.resolve(result.result) : p.reject(new Error(result.error)),
    );
    return true;
  }

  private settle(id: string, fn: () => void) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    fn();
  }

  private latestSession(): string | undefined {
    let latest: [string, MapTab] | undefined;
    for (const entry of this.tabs) {
      if (!latest || entry[1].attachedAt > latest[1].attachedAt) latest = entry;
    }
    return latest?.[0];
  }
}

// Route handlers are bundled separately and re-evaluated on HMR; keep one hub per process.
const globalForHub = globalThis as typeof globalThis & { __keplerBridgeHub?: KeplerBridgeHub };

export const keplerBridgeHub = (globalForHub.__keplerBridgeHub ??= new KeplerBridgeHub());
