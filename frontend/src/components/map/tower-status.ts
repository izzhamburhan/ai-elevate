import { useSyncExternalStore } from "react";

/** All of Malaysia, so Sabah and Sarawak count too. */
const MALAYSIA_BBOX = { min_lat: 0.8, min_lng: 99.5, max_lat: 7.5, max_lng: 119.5 };

/** The tower MCP's largest page; more than the network has towers in any one status. */
const LIMIT = 2000;

/** How often the network status refreshes while the workspace is open and visible. */
export const TOWER_STATUS_REFRESH_MS = 60_000;

/** A status this recent is reused rather than fetched again (a new chat's map and the count both ask on load). */
const FRESH_MS = 10_000;

export type TowerPin = { enodeb_name: string; site_id: string; town: string; state: string; lat: number; lng: number; status: string };

export type TowerStatus = {
  down: TowerPin[];
  degraded: number;
  /** The tower MCP's scenario clock (ISO, +08:00), not the browser's. */
  asOf?: string;
  synthetic: boolean;
  /** Towers down now that weren't at the previous refresh; none on the first. */
  newlyDown: string[];
  fetchedAt: number;
};

export type TowerStatusState = { status?: TowerStatus; error?: string; loading: boolean };

type Envelope = { error?: string; synthetic?: boolean; as_of?: string; data?: { towers?: TowerPin[] } };

async function listTowers(status: "DOWN" | "DEGRADED"): Promise<Envelope> {
  const res = await fetch("/api/menara/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "tower_list_in_bbox", args: { ...MALAYSIA_BBOX, status, limit: LIMIT } }),
  });
  const body = (await res.json().catch(() => ({}))) as Envelope;
  if (!res.ok) throw new Error(body.error ?? `Tower request failed (${res.status})`);
  return body;
}

let state: TowerStatusState = { loading: false };
let inflight: Promise<TowerStatus> | undefined;
const listeners = new Set<() => void>();

function set(next: Partial<TowerStatusState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

/** Fetches the down and degraded towers across Malaysia, joining a request already in flight. */
export function refreshTowerStatus(): Promise<TowerStatus> {
  inflight ??= (async () => {
    set({ loading: true });
    try {
      const [down, degraded] = await Promise.all([listTowers("DOWN"), listTowers("DEGRADED")]);
      const towers = down.data?.towers ?? [];
      const previous = state.status && new Set(state.status.down.map((t) => t.enodeb_name));
      const status: TowerStatus = {
        down: towers,
        degraded: degraded.data?.towers?.length ?? 0,
        asOf: down.as_of,
        synthetic: Boolean(down.synthetic || degraded.synthetic),
        newlyDown: previous ? towers.map((t) => t.enodeb_name).filter((name) => !previous.has(name)) : [],
        fetchedAt: Date.now(),
      };
      set({ status, error: undefined, loading: false });
      return status;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
}

/** The latest status when it is only seconds old, else a fresh one. */
export function currentTowerStatus(): Promise<TowerStatus> {
  const { status } = state;
  return status && Date.now() - status.fetchedAt < FRESH_MS ? Promise.resolve(status) : refreshTowerStatus();
}

const ignore = () => {};

function refreshIfStale() {
  const { status } = state;
  if (document.visibilityState !== "visible") return;
  if (status && Date.now() - status.fetchedAt < TOWER_STATUS_REFRESH_MS - FRESH_MS) return;
  refreshTowerStatus().catch(ignore);
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Polls while anything listens; a hidden tab skips refreshes and catches up when shown again. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    refreshIfStale();
    timer = setInterval(refreshIfStale, TOWER_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfStale);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refreshIfStale);
  };
}

const getState = () => state;

/** The live network status, refreshed every minute while a component uses it. */
export function useTowerStatus() {
  return useSyncExternalStore(subscribe, getState, getState);
}
