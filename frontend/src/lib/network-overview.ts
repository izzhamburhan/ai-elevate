"use client";

import { useSyncExternalStore } from "react";

export type OverviewTower = {
  enodeb_name: string;
  site_id: string;
  town: string;
  state: string;
  lat: number;
  lng: number;
  status: string;
};

/** Problem towers in one town, ranked by `score` (down x5, critical alarm x3, degraded x2, major x1). */
export type Hotspot = {
  id: string;
  town: string;
  state: string;
  score: number;
  down: string[];
  degraded: string[];
  critical: number;
  major: number;
  /** Every problem tower in the town. */
  towers: string[];
  /** Problem towers that already have an open incident. */
  incidents: number;
  lat: number;
  lng: number;
};

export type OpenIncident = { incident_id: string; enodeb_name: string; status: string; cause: string; summary: string };
export type PendingApproval = { approval_id: string; action: string; target: string };

export type NetworkOverview = {
  asOf: string | null;
  towers: OverviewTower[];
  towersByStatus: Record<string, number>;
  alarmsBySeverity: Record<string, number>;
  hotspots: Hotspot[];
  openIncidents: OpenIncident[];
  pendingApprovals: PendingApproval[];
  /** The server cut a list at its limit, so counts are a lower bound. */
  truncated: boolean;
};

/** Fired by the refresh button; the map reloads the tower layer when it hears it. */
export const OVERVIEW_REFRESH_EVENT = "elevate:overview-refresh";

/** What changed between the last two refreshes. */
export type OverviewDelta = { newlyDown: string[]; recovered: string[]; since: number };

type State = { overview?: NetworkOverview; delta?: OverviewDelta; error?: string; loading: boolean; fetchedAt?: number };

/** How often the board and the map refresh on their own. */
export const OVERVIEW_POLL_MS = 60_000;

const downSet = (o: NetworkOverview) => new Set(o.towers.filter((t) => t.status === "DOWN").map((t) => t.enodeb_name));

/** Keeps the last non-empty change so the board can show it until something newer happens. */
function deltaOf(prev: State, next: NetworkOverview): OverviewDelta | undefined {
  if (!prev.overview || prev.fetchedAt === undefined) return undefined;
  const before = downSet(prev.overview);
  const after = downSet(next);
  const newlyDown = [...after].filter((n) => !before.has(n));
  const recovered = [...before].filter((n) => !after.has(n));
  if (newlyDown.length === 0 && recovered.length === 0) return prev.delta;
  return { newlyDown, recovered, since: prev.fetchedAt };
}

let state: State = { loading: false };
const listeners = new Set<() => void>();
const setState = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

/** Fetches the overview into the shared state. Later callers while one is in flight get the same one. */
let inflight: Promise<NetworkOverview | undefined> | undefined;
export function refreshOverview(): Promise<NetworkOverview | undefined> {
  inflight ??= (async () => {
    setState({ ...state, loading: true });
    try {
      const res = await fetch("/api/overview", { cache: "no-store" });
      const body = (await res.json()) as NetworkOverview & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load the network overview.");
      setState({ overview: body, delta: deltaOf(state, body), loading: false, fetchedAt: Date.now() });
      return body;
    } catch (error) {
      setState({ ...state, error: error instanceof Error ? error.message : "Overview failed.", loading: false });
      return undefined;
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
}

export function useNetworkOverview(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
