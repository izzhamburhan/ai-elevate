"use client";

import { create } from "zustand";

import type { HermesAgentId, HermesJob } from "@/lib/hermes/contracts";
import type { Discovery } from "@/lib/opportunities/contracts";

/**
 * The Agents tab's selection and current investigation. It lives in its own module so the map's
 * command deck can follow the same job (and keep polling it) while the tab is closed: kepler only
 * mounts the active tab. Persistent agent memory remains exclusively in Hermes profiles.
 */
export type Selection = {
  agentId: HermesAgentId; prompt: string; job: HermesJob | null;
  investigationId: string | null; sessions: Partial<Record<HermesAgentId, string>>; discovery: Discovery | null;
  /** The Business Hypothesis run validating `discovery`, kept apart from later investigations. */
  discoveryRunId: string | null; discoveryJob: HermesJob | null;
  attachArea: boolean; areaSource: "shape" | "tower"; areaCleared: string | null;
  /** The investigation whose findings are on the map. */
  mappedId: string | null;
  /** The investigation whose briefing card over the map was closed. */
  briefingClosedId: string | null;
};

// Tab switches retain the investigation.
export const useHermesSelection = create<Selection>(() => ({
  agentId: "engineer", prompt: "Check network health in the selected area: KPIs and NTT tickets for its sites on the latest data day, and which sites need attention.",
  job: null, investigationId: null, sessions: {}, discovery: null, discoveryRunId: null, discoveryJob: null,
  attachArea: true, areaSource: "shape", areaCleared: null, mappedId: null, briefingClosedId: null,
}));

/** Records a polled job: the job itself, its agent's session, and the discovery run it may validate. */
export function applyPolledJob(result: HermesJob) {
  useHermesSelection.setState((state) => ({
    job: result, sessions: result.session_id ? { ...state.sessions, [result.agent_id]: result.session_id } : state.sessions,
    ...(result.investigation_id === state.discoveryRunId ? { discoveryJob: result } : {}),
  }));
}
