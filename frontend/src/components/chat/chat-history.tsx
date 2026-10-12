"use client";

import { useMemo, type ReactNode } from "react";
import {
  RuntimeAdapterProvider,
  createSimpleTitleAdapter,
  useAui,
  type AssistantClient,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type MessageStorageEntry,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

/**
 * Chat history saved in this browser's IndexedDB (tool results such as map data quickly outgrow
 * localStorage's ~5 MB). Plugs into assistant-ui as a thread-list adapter: the list of chats plus,
 * per chat, a history adapter that stores the AI SDK messages exactly as the runtime hands them over,
 * plus a snapshot of the map that chat built.
 * If storage is unavailable (e.g. a locked-down private window) chats still work, just unsaved.
 */

// ---------------------------------------------------------------------------------------------
// Storage: one key-value object store, every read-modify-write serialised through one queue

const DB_NAME = "elevate-chat";
const STORE = "kv";
const THREADS_KEY = "threads";
const messagesKey = (remoteId: string) => `messages:${remoteId}`;
const mapKey = (remoteId: string) => `map:${remoteId}`;

type StoredThread = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  createdAt: number;
  lastMessageAt?: number;
  custom?: Record<string, unknown>;
};

type StoredEntry = MessageStorageEntry<Record<string, unknown>>;

type StoredMessages = {
  headId: string | null;
  /** In write order, so a parent always precedes its children. */
  entries: StoredEntry[];
};

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((error) => {
    dbPromise = undefined; // let a later call retry
    throw error;
  });
  return dbPromise;
}

async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const kv = {
  get: <T,>(key: string) => request<T | undefined>("readonly", (s) => s.get(key)),
  set: (key: string, value: unknown) => request<void>("readwrite", (s) => s.put(value, key)),
  remove: (key: string) => request<void>("readwrite", (s) => s.delete(key)),
};

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const readThreads = async () => (await kv.get<StoredThread[]>(THREADS_KEY)) ?? [];

function patchThread(remoteId: string, patch: Partial<StoredThread>) {
  return serial(async () => {
    const threads = await readThreads();
    const thread = threads.find((t) => t.remoteId === remoteId);
    if (!thread) return;
    Object.assign(thread, patch);
    await kv.set(THREADS_KEY, threads);
  });
}

/** Drops functions/undefined so the value is safe to structured-clone into IndexedDB. */
const toPlain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function saveEntry(remoteId: string, entry: StoredEntry, moveHead: boolean) {
  return serial(async () => {
    const threads = await readThreads();
    const thread = threads.find((t) => t.remoteId === remoteId);
    if (!thread) return; // deleted while this write was queued
    const stored = (await kv.get<StoredMessages>(messagesKey(remoteId))) ?? { headId: null, entries: [] };
    const index = stored.entries.findIndex((e) => e.id === entry.id);
    if (index >= 0) stored.entries[index] = entry;
    else stored.entries.push(entry);
    if (moveHead) stored.headId = entry.id;
    thread.lastMessageAt = Date.now();
    await kv.set(messagesKey(remoteId), stored);
    await kv.set(THREADS_KEY, threads);
  });
}

function removeEntries(remoteId: string, ids: ReadonlySet<string>) {
  return serial(async () => {
    const stored = await kv.get<StoredMessages>(messagesKey(remoteId));
    if (!stored) return;
    stored.entries = stored.entries.filter((e) => !ids.has(e.id));
    if (stored.headId && ids.has(stored.headId)) stored.headId = stored.entries.at(-1)?.id ?? null;
    await kv.set(messagesKey(remoteId), stored);
  });
}

const warnUnsaved = (error: unknown) => console.warn("[chat-history] Chat history is not being saved:", error);

// ---------------------------------------------------------------------------------------------
// Per-chat map: the kepler.gl datasets + config the chat left on the map (see chat-map-sync.ts)

export type MapSnapshot = {
  /** `KeplerGlSchema.getDatasetToSave` output. */
  datasets: unknown;
  /** `KeplerGlSchema.getConfigToSave` output. */
  config: unknown;
  savedAt: number;
};

export function loadMapSnapshot(remoteId: string) {
  return kv.get<MapSnapshot>(mapKey(remoteId)).catch((error) => {
    warnUnsaved(error);
    return undefined;
  });
}

export function saveMapSnapshot(remoteId: string, snapshot: MapSnapshot) {
  return serial(async () => {
    const threads = await readThreads();
    if (!threads.some((t) => t.remoteId === remoteId)) return; // deleted while this write was queued
    await kv.set(mapKey(remoteId), toPlain(snapshot));
  }).catch(warnUnsaved);
}

// ---------------------------------------------------------------------------------------------
// Per-thread message history

type ThreadItem = ReturnType<AssistantClient["threads"]["item"]>;

function createHistoryAdapter(getAui: () => AssistantClient): ThreadHistoryAdapter {
  // Resolve the item by id rather than holding the live accessor, which follows thread switches.
  const currentItem = (): ThreadItem | undefined => {
    const aui = getAui();
    if (!aui.threadListItem.source) return undefined;
    return aui.threads.item({ id: aui.threadListItem.getState().id });
  };

  return {
    // The AI SDK runtime only ever talks to the formatted adapter below.
    load: async () => ({ messages: [] }),
    append: async () => {},

    withFormat<TMessage, TStorage extends Record<string, unknown>>(
      format: MessageFormatAdapter<TMessage, TStorage>,
    ): GenericThreadHistoryAdapter<TMessage> {
      // pinned when a run starts, so a reply that finishes after a switch lands in its own chat
      let pinned: ThreadItem | undefined;
      const target = () => pinned ?? currentItem();

      const write = async (item: MessageFormatItem<TMessage>, moveHead: boolean) => {
        const thread = target();
        if (!thread) return;
        const remoteId = thread.getState().remoteId ?? (await thread.initialize()).remoteId;
        const entry: StoredEntry = {
          id: format.getId(item.message),
          parent_id: item.parentId,
          format: format.format,
          content: toPlain(format.encode(item)),
        };
        await saveEntry(remoteId, entry, moveHead).catch(warnUnsaved);
      };

      return {
        pin() {
          pinned = currentItem() ?? pinned;
        },
        async load() {
          pinned = currentItem() ?? pinned;
          const remoteId = target()?.getState().remoteId;
          if (!remoteId) return { messages: [] };
          const stored = await kv.get<StoredMessages>(messagesKey(remoteId)).catch(() => undefined);
          if (!stored) return { messages: [] };

          const loaded = new Set<string>();
          const messages: MessageFormatItem<TMessage>[] = [];
          for (const entry of stored.entries) {
            if (entry.format !== format.format) continue;
            if (entry.parent_id !== null && !loaded.has(entry.parent_id)) continue; // orphan
            loaded.add(entry.id);
            messages.push(format.decode(entry as MessageStorageEntry<TStorage>));
          }
          const headId = stored.headId && loaded.has(stored.headId) ? stored.headId : undefined;
          return { ...(headId ? { headId } : undefined), messages };
        },
        append: (item) => write(item, true),
        update: (item) => write(item, false),
        async delete(items) {
          const remoteId = target()?.getState().remoteId;
          if (!remoteId) return;
          await removeEntries(remoteId, new Set(items.map((i) => format.getId(i.message)))).catch(warnUnsaved);
        },
      };
    },
  };
}

/** Wraps each mounted chat so its runtime finds that chat's history adapter. */
function ChatHistoryProvider({ children }: { children?: ReactNode }) {
  const aui = useAui();
  const adapters = useMemo(() => ({ history: createHistoryAdapter(() => aui) }), [aui]);
  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
}

// ---------------------------------------------------------------------------------------------
// Thread list

const titles = createSimpleTitleAdapter();

type RemoteThreadMetadata = Awaited<ReturnType<RemoteThreadListAdapter["fetch"]>>;

const toMetadata = (t: StoredThread): RemoteThreadMetadata => ({
  remoteId: t.remoteId,
  status: t.status,
  title: t.title,
  lastMessageAt: new Date(t.lastMessageAt ?? t.createdAt),
  custom: t.custom,
});

export const chatThreadListAdapter: RemoteThreadListAdapter = {
  unstable_Provider: ChatHistoryProvider,

  async list() {
    const threads = await readThreads().catch((error) => {
      warnUnsaved(error);
      return [];
    });
    const recency = (t: StoredThread) => t.lastMessageAt ?? t.createdAt;
    return { threads: threads.sort((a, b) => recency(b) - recency(a)).map(toMetadata) };
  },

  // A chat is saved from its first message on; the local id doubles as the stored id.
  async initialize(threadId) {
    await serial(async () => {
      const threads = await readThreads();
      if (threads.some((t) => t.remoteId === threadId)) return;
      threads.unshift({ remoteId: threadId, status: "regular", createdAt: Date.now() });
      await kv.set(THREADS_KEY, threads);
    }).catch(warnUnsaved);
    return { remoteId: threadId, externalId: undefined };
  },

  async fetch(threadId) {
    const thread = (await readThreads()).find((t) => t.remoteId === threadId);
    if (!thread) throw new Error(`Chat "${threadId}" is not in this browser's history.`);
    return toMetadata(thread);
  },

  rename: (remoteId, title) => patchThread(remoteId, { title }).catch(warnUnsaved),
  updateCustom: (remoteId, custom) => patchThread(remoteId, { custom }).catch(warnUnsaved),
  archive: (remoteId) => patchThread(remoteId, { status: "archived" }).catch(warnUnsaved),
  unarchive: (remoteId) => patchThread(remoteId, { status: "regular" }).catch(warnUnsaved),

  delete: (remoteId) =>
    serial(async () => {
      const threads = await readThreads();
      await kv.set(
        THREADS_KEY,
        threads.filter((t) => t.remoteId !== remoteId),
      );
      await kv.remove(messagesKey(remoteId));
      await kv.remove(mapKey(remoteId));
    }).catch(warnUnsaved),

  // Titles come from the first user message. The runtime expects a generation to save its own
  // title (it only calls `rename` to repair races), and the write must land before the stream ends.
  async generateTitle(remoteId, messages) {
    const title = await titles.generateTitle(messages);
    await patchThread(remoteId, { title }).catch(warnUnsaved);
    return createAssistantStream((controller) => {
      controller.appendText(title);
    });
  },
};
