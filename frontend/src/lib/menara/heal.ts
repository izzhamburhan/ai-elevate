import { callMenaraTool, dataOf } from "./call";

/**
 * The self-healing loop, made visible: detect, diagnose, simulate, approve, apply, verify, rollback, recover.
 * It works on any tower that is DOWN or DEGRADED in the data (the NetOps outages and the flood): it reads the
 * tower's status, alarm, power and flood, picks the fix that fits and drives the real MCP servers. Every action
 * waits for a person to approve it (human in the loop). `healState` reads the servers for the chart and the map.
 * All data is synthetic.
 */
export const STAGES = ["detect", "diagnose", "simulate", "approve", "apply", "verify", "rollback", "recover"] as const;
export type Stage = (typeof STAGES)[number];
/** Why neighbours are tilted: to cover a dead tower's area, or to shed an overloaded neighbour's load. */
export type TiltPurpose = "cover" | "shed";

export const THRESHOLD_PRB = 85;
const FLOOD_TOWER = "KKRI-0142"; // the flood story's tower, healed only when asked for by name
const MAX_WINDOW_MIN = 1440; // tower_get_kpi's limit
const LEAD_MIN = 240;
const MAX_POINTS = 200;
const MAX_WATCHED = 4;
const TILT_DEG = 4; // downtilt that sheds load from an overloaded neighbour (load balancing)
const COVER_TILT_DEG = 2; // uptilt that stretches a neighbour over a dead tower's area (outage compensation)
const KPI_STEP_MIN = 15; // the clock moves in these steps until a KPI sample after a change exists
const CREW_WAIT_STEP_MIN = 30;
const CREW_WAIT_MAX_MIN = 12 * 60;
const APPROVER = "elevate-ui-human";
const RESOLVER = "elevate-self-heal";
/** The diagnosis cause as an NTT fault type. */
const NTT_FAULT: Record<string, string> = { FLOOD: "FLOOD", POWER: "POWER", TRANSPORT: "FIBER", CONFIG: "RAN", HARDWARE: "HARDWARE" };

type Args = Record<string, unknown>;
type Data = Record<string, unknown>;

// ---------------------------------------------------------------- run manager (one run at a time)

export type RunEvent =
  | { type: "stage"; step: number | null; stage: Stage; attempt: number; label: string; blocked?: boolean }
  // `action` and `targets` let the map draw what is proposed; `purpose` says what a neighbour tilt is for
  | { type: "approval"; approvalId: string; summary: string; action: string; targets: string[]; purpose?: TiltPurpose }
  | { type: "final"; status: "done" | "stopped" | "cancelled" | "error"; text: string };

type Run = {
  id: string;
  tower: string;
  status: "running" | "done" | "stopped" | "cancelled" | "error";
  events: RunEvent[];
  cancelled: boolean;
  pending: ((approve: boolean) => void) | null;
};

// kept on globalThis so dev hot reloads do not lose the run
const holder = globalThis as unknown as { __elevateHealRun?: Run };

export function currentRun(): Run | undefined {
  return holder.__elevateHealRun;
}

/** Starts healing `tower`, or the most urgent faulty tower when none is named. */
export async function startHeal(tower?: string): Promise<{ runId: string; tower: string }> {
  if (holder.__elevateHealRun?.status === "running") throw new Error("A self-heal run is already in progress.");
  const target = tower?.trim().toUpperCase() || (await pickTarget());
  const run: Run = { id: crypto.randomUUID().slice(0, 8), tower: target, status: "running", events: [], cancelled: false, pending: null };
  holder.__elevateHealRun = run;
  void execute(run);
  return { runId: run.id, tower: target };
}

export function decide(runId: string, approve: boolean): boolean {
  const run = holder.__elevateHealRun;
  if (!run || run.id !== runId || !run.pending) return false;
  const resolve = run.pending;
  run.pending = null;
  resolve(approve);
  return true;
}

export function cancel(runId: string): boolean {
  const run = holder.__elevateHealRun;
  if (!run || run.id !== runId || run.status !== "running") return false;
  run.cancelled = true;
  if (run.pending) decide(runId, false);
  return true;
}

export function clearRun() {
  if (holder.__elevateHealRun?.status === "running") throw new Error("A self-heal run is in progress.");
  holder.__elevateHealRun = undefined;
}

/**
 * The real outage with the most severe active alarm (the NetOps faults). The flood story's cluster is left out:
 * it is healed only when asked for by name (KKRI-0142).
 */
async function pickTarget(): Promise<string> {
  const story = `${FLOOD_TOWER.split("-")[0]}-`;
  const alarms = ((await safe("tower_get_alarms", { active_only: true, limit: 200 })).alarms as { enodeb_name: string }[] | undefined) ?? [];
  const real = alarms.find((a) => !a.enodeb_name.startsWith(story)); // the server sorts by severity
  if (!real) throw new Error("No tower outside the flood demo has an active alarm right now: there is nothing to heal.");
  return real.enodeb_name;
}

// ---------------------------------------------------------------- the loop

class Stopped extends Error {}

type Neighbour = { enodeb_name: string; status: string; prb_util: number | null };
type Alarm = { code: string; message: string; raised_at?: string };
type Diagnosis = { cause: string; confidence: number; skill: string | null; remote: "reset" | null; why: string; problem: string };

/** What the evidence says is wrong, and who or what can fix it. */
function diagnose(status: Data, alarms: Alarm[], power: Data, flood: Data): Diagnosis {
  const codes = new Set(alarms.map((a) => a.code));
  const feeder = (power.feeder as { status?: string; note?: string } | undefined) ?? {};
  const noMains = status.mains_ok === false || (feeder.status != null && feeder.status !== "ENERGISED");
  if (noMains && flood.inside_flood === true) {
    return {
      cause: "FLOOD",
      confidence: 0.93,
      skill: "POWER",
      remote: null,
      why: `Floodwater at the site and no mains power (feeder ${feeder.status ?? "off"})`,
      problem: "power lost to the flood",
    };
  }
  if (noMains) return { cause: "POWER", confidence: 0.9, skill: "POWER", remote: null, why: `No mains power: feeder ${feeder.status ?? "off"}`, problem: "power loss" };
  if (codes.has("LINK_DOWN")) return { cause: "TRANSPORT", confidence: 0.9, skill: "FIBRE", remote: null, why: "Backhaul link down", problem: "broken backhaul link" };
  if (codes.size && [...codes].every((c) => c === "CELL_HUNG")) {
    return {
      cause: "CONFIG",
      confidence: 0.9,
      skill: "RAN",
      remote: "reset",
      why: "A cell is hung (not carrying traffic); a soft reset usually clears it",
      problem: "hung cell",
    };
  }
  if (codes.has("VSWR")) {
    return { cause: "HARDWARE", confidence: 0.85, skill: "RAN", remote: null, why: "Antenna VSWR above threshold (feeder or antenna fault)", problem: "antenna fault" };
  }
  if (codes.has("HIGH_TEMP")) {
    return { cause: "HARDWARE", confidence: 0.85, skill: "CIVIL", remote: null, why: "Cabinet temperature above threshold (cooling fault)", problem: "cabinet cooling fault" };
  }
  return { cause: "UNKNOWN", confidence: 0.5, skill: "RAN", remote: null, why: alarms[0]?.message ?? `Tower is ${String(status.status)}`, problem: "fault" };
}

async function execute(run: Run) {
  const T = run.tower;
  let tiltAttempt = 0;
  /** `blocked` marks the stage the run stopped at (a rejection, a policy denial, no crew). */
  const say = (stage: Stage, label: string, attempt = 0, blocked = false) =>
    run.events.push({ type: "stage", step: null, stage, attempt, label, ...(blocked ? { blocked } : {}) });
  const call = async (tool: string, args: Args) => {
    if (run.cancelled) throw new Stopped("Run cancelled.");
    return dataOf(await callMenaraTool(tool, args));
  };
  const advance = (minutes: number) => call("demo_advance_clock", { minutes });
  let activeTilt: { change_id: string; towers: string[] } | null = null;
  const leftAsIs = () => (activeTilt ? `the neighbour tilt ${activeTilt.change_id} stays until ${T} is back` : "nothing was changed");

  /** Human in the loop: policy first, then a person decides. Returns a token, or stops the run. */
  const authorise = async (action: string, targets: string[], confidence: number, reason: string, what: string, purpose?: TiltPurpose) => {
    const check = await call("policy_check_action", { action, targets, confidence, reason });
    const decision = String(check.decision);
    if (decision === "deny") {
      say("approve", "Policy: denied", 0, true);
      throw new Stopped(`Policy denied ${what}: ${String(check.reason ?? "")}. The run stopped; ${leftAsIs()}.`);
    }
    say("approve", decision === "ask" ? "Policy: a human must approve" : "Policy: allowed; waiting for you");
    const approvalId = String(check.approval_id ?? `local-${run.events.length}`);
    const asked = Date.now();
    const approved = await new Promise<boolean>((resolve) => {
      run.pending = resolve;
      run.events.push({ type: "approval", approvalId, summary: `${what}. Policy: ${String(check.reason ?? decision)}`, action, targets, ...(purpose ? { purpose } : {}) });
    });
    const key = process.env.MENARA_APPROVER_KEY ?? "dev-only-approver-key";
    if (!approved) {
      if (check.approval_id) await callMenaraTool("policy_reject", { approval_id: approvalId, approver: APPROVER, approver_key: key });
      say("approve", run.cancelled ? "Cancelled" : "Rejected by you", 0, true);
      throw new Stopped(run.cancelled ? "Run cancelled." : `You rejected: ${what}. The run stopped and the incident stays open; ${leftAsIs()}.`);
    }
    say("approve", "Policy: a human approved");
    if (decision === "ask") {
      const granted = dataOf(await callMenaraTool("policy_approve", { approval_id: approvalId, approver: APPROVER, approver_key: key }));
      return String(granted.token ?? "");
    }
    // an "allow" token is short-lived: ask policy again if the person took a while
    if (Date.now() - asked > 4 * 60_000) return String((await call("policy_check_action", { action, targets, confidence, reason })).token ?? "");
    return String(check.token ?? "");
  };

  /** Latest PRB of a tower, moving the clock until there is a sample taken after minute `after`. */
  const loadAfter = async (tower: string, after: number) => {
    for (let i = 0; i < 4; i++) {
      await advance(KPI_STEP_MIN);
      const kpi = await call("tower_get_kpi", { enodeb_name: tower, window_min: 60 });
      const last = (kpi.points as { t_min: number; prb_util: number }[] | undefined)?.at(-1);
      if (last && last.t_min > after) return last.prb_util;
    }
    return null;
  };
  const clockNow = async () => Number((await call("demo_get_clock", {})).t_min ?? 0);

  /**
   * Cell outage compensation: neighbours that are UP, can tilt up and stay under the overload line in the twin
   * uptilt by COVER_TILT_DEG to reach users in the dead tower's area. Returns the change, or null if none fit or it
   * overloaded them (then it is rolled back).
   */
  const compensate = async (confidence: number): Promise<{ change_id: string; towers: string[] } | null> => {
    const now = ((await call("tower_get_status", { enodeb_name: T })).neighbours as Neighbour[] | undefined) ?? [];
    const up = now.filter(
      (n) => n.enodeb_name !== T && n.status === "UP" && n.prb_util != null,
    );
    const tiltable: Neighbour[] = [];
    for (const n of up) {
      const cells = ((await call("ran_get_config", { enodeb_name: n.enodeb_name })).cells as { tilt_deg: number }[] | undefined) ?? [];
      if (cells.length && cells.every((c) => c.tilt_deg >= COVER_TILT_DEG)) tiltable.push(n);
    }
    const simulate = (towers: string[]) =>
      call("twin_simulate_tilt", { changes: towers.map((enodeb_name) => ({ enodeb_name, tilt_delta_deg: -COVER_TILT_DEG })) });
    const predictions = (sim: Data) => (sim.tilted as { enodeb_name: string; predicted_prb: number | null }[] | undefined) ?? [];
    let sim = tiltable.length ? await simulate(tiltable.map((n) => n.enodeb_name)) : {};
    const fit = predictions(sim)
      .filter((p) => p.predicted_prb != null && p.predicted_prb < THRESHOLD_PRB)
      .map((p) => p.enodeb_name);
    if (!fit.length) {
      say("simulate", `No neighbour has room to cover ${T}: no tilt`);
      return null;
    }
    if (fit.length < tiltable.length) sim = await simulate(fit);
    const predicted = predictions(sim)
      .map((p) => `${p.enodeb_name} at ${p.predicted_prb}%`)
      .join(", ");
    say("simulate", `Twin: a ${COVER_TILT_DEG}° uptilt covers ${T}'s area and keeps ${predicted}`);

    const reason = `Cover the area of ${T} while it is down`;
    const token = await authorise(
      "ran_tilt_cells",
      fit,
      confidence,
      reason,
      `Uptilt ${fit.join(", ")} by ${COVER_TILT_DEG}° so they cover ${T}'s area while it is down`,
      "cover",
    );
    const before = Object.fromEntries(up.map((n) => [n.enodeb_name, n.prb_util ?? 0]));
    const applied = await clockNow();
    const change = await call("ran_tilt_cells", {
      changes: fit.map((enodeb_name) => ({ enodeb_name, tilt_delta_deg: -COVER_TILT_DEG })),
      policy_token: token,
      reason,
    });
    const made = { change_id: String(change.change_id), towers: fit };
    activeTilt = made;
    say("apply", `Uptilted ${fit.join(", ")} by ${COVER_TILT_DEG}° to cover ${T}`);
    await moveIncident("MITIGATING", `Uptilted ${fit.join(", ")} ${COVER_TILT_DEG}° to cover the area of ${T} (${made.change_id}).`);

    const overloaded: string[] = [];
    for (const tower of fit) {
      const after = await loadAfter(tower, applied);
      const ok = after != null && after < THRESHOLD_PRB;
      say("verify", `${tower}: ${before[tower].toFixed(0)}% to ${after != null ? `${after.toFixed(0)}%` : "no sample"} ${ok ? "(covering, has room)" : "(overloaded)"}`);
      if (!ok) overloaded.push(tower);
    }
    if (!overloaded.length) return made;
    const undo = await authorise("ran_revert_tilt", fit, 0.99, "The uptilt overloaded a neighbour", `Roll back ${made.change_id}: ${overloaded.join(", ")} overloaded`);
    await call("ran_revert_change", { change_id: made.change_id, policy_token: undo, reason: "The uptilt overloaded a neighbour" });
    say("rollback", `Rolled back ${made.change_id}`);
    activeTilt = null;
    return null;
  };

  let incidentId = "";
  let incidentStatus = "OPEN";
  const note = async (text: string) => {
    if (incidentId) await call("ontology_add_incident_note", { incident_id: incidentId, note: text.slice(0, 500) }).catch(() => null);
  };
  const moveIncident = async (status: "MITIGATING" | "RESOLVED", text: string) => {
    if (!incidentId || incidentStatus === status) return note(text);
    await call("ontology_update_incident", { incident_id: incidentId, status, note: text.slice(0, 500) });
    incidentStatus = status;
  };

  // The Network Trouble Ticket (NTT) for the fault, with the customer tickets raised near the tower since it began
  // linked to it; resolving it on recovery closes them too. Ticketing is bookkeeping: if it fails the run goes on.
  let nttId = "";
  let faultSince: string | undefined;
  const nearbyTickets = async () =>
    (((await call("ticket_list_open_near_tower", { enodeb_name: T, ...(faultSince ? { since: faultSince } : {}) })).tickets as
      | { ticket_id: string }[]
      | undefined) ?? []).map((t) => t.ticket_id);
  const ticketing = async (stage: Stage, what: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if (error instanceof Stopped) throw error;
      say(stage, `Ticketing: could not ${what} (${error instanceof Error ? error.message : String(error)})`);
    }
  };

  try {
    // ---- detect
    const status = await call("tower_get_status", { enodeb_name: T });
    const alarms = ((await call("tower_get_alarms", { enodeb_name: T, active_only: true })).alarms as Alarm[] | undefined) ?? [];
    faultSince = alarms.map((a) => a.raised_at).filter((at): at is string => !!at).sort()[0];
    say("detect", `${T} is ${String(status.status)}${alarms.length ? `: ${alarms[0].code}` : ""}`);
    const neighbours = ((status.neighbours as Neighbour[] | undefined) ?? []).filter((n) => n.enodeb_name !== T);
    const hot = neighbours.filter((n) => n.status === "UP" && (n.prb_util ?? 0) >= THRESHOLD_PRB);
    if (status.status === "UP" && !alarms.length && !hot.length) {
      run.events.push({ type: "final", status: "done", text: `${T} is UP with no active alarms and its neighbours have headroom: nothing to heal.` });
      run.status = "done";
      return;
    }

    // ---- diagnose
    const power = await call("grid_get_tower_power", { enodeb_name: T }).catch(() => ({}) as Data);
    const flood = Number.isFinite(Number(status.lat))
      ? await call("flood_check_point", { lat: Number(status.lat), lng: Number(status.lng) }).catch(() => ({}) as Data)
      : {};
    const dx = diagnose(status, alarms, power, flood);
    const blast = await call("ontology_blast_radius", { site: T, radius_km: 5 }).catch(() => ({}) as Data);
    say("diagnose", `${dx.cause}: ${dx.why}`);

    const open = (((await call("ontology_list_incidents", { enodeb_name: T })).incidents as { incident_id: string; status: string }[] | undefined) ?? []).find(
      (i) => i.status !== "RESOLVED",
    );
    if (open) {
      incidentId = open.incident_id;
      incidentStatus = open.status;
      await note(`Self-heal picked this up again. Diagnosis: ${dx.cause}, ${dx.why}.`);
      say("diagnose", `Incident ${incidentId} already open: continuing it`);
    } else {
      const made = await call("ontology_create_incident", {
        enodeb_name: T,
        cause: dx.cause,
        cause_confidence: dx.confidence,
        summary: `${T} ${String(status.status)}: ${dx.why}. About ${Number(blast.subscribers_at_risk ?? 0).toLocaleString("en")} subscribers nearby.`.slice(0, 500),
      });
      incidentId = String(made.incident_id ?? "");
      say("diagnose", `Incident ${incidentId} opened (${dx.cause})`);
    }
    if (status.status !== "UP") {
      await ticketing("diagnose", "raise the NTT", async () => {
        const ntt = await call("ticket_create_ntt", {
          network_element_id: T,
          fault_type: NTT_FAULT[dx.cause] ?? "OTHER",
          severity: status.status === "DOWN" ? "CRITICAL" : "MAJOR",
          summary: `${T} ${String(status.status)}: ${dx.why}`.slice(0, 500),
          ctt_ticket_ids: await nearbyTickets(),
          // the outage the MCMC check measures runs from the first alarm, not from when this run noticed it
          ...(faultSince ? { fault_began_at: faultSince } : {}),
        });
        nttId = String(ntt.ntt_id ?? "");
        const linked = Number(ntt.ctt_count ?? 0);
        say("diagnose", `${nttId}: ${linked} customer ticket${linked === 1 ? "" : "s"} linked`);
        await note(`Network trouble ticket ${nttId} tracks this fault (${linked} customer tickets linked).`);
      });
    }

    // ---- simulate, then act on the neighbours: shed load from overloaded ones (load balancing), or, when the
    // tower is down and they have room, uptilt them to cover its area (cell outage compensation)
    if (hot.length) {
      let targets = hot.map((n) => n.enodeb_name);
      const before = Object.fromEntries(hot.map((n) => [n.enodeb_name, n.prb_util ?? 0]));
      for (tiltAttempt = 1; tiltAttempt <= 2 && targets.length; tiltAttempt++) {
        const changes = targets.map((enodeb_name) => ({ enodeb_name, tilt_delta_deg: TILT_DEG }));
        const sim = await call("twin_simulate_tilt", { changes });
        const predicted = ((sim.tilted as { enodeb_name: string; predicted_prb: number | null }[] | undefined) ?? [])
          .map((p) => `${p.enodeb_name} to ${p.predicted_prb ?? "?"}%`)
          .join(", ");
        say("simulate", `Twin: ${TILT_DEG}° downtilt takes ${predicted || "the neighbours"} (${sim.recommended ? "recommended" : "not recommended"})`);
        const token = await authorise(
          "ran_tilt_cells",
          targets,
          dx.confidence,
          `Relieve overloaded neighbours of ${T}`,
          `Tilt ${targets.join(", ")} down by ${TILT_DEG}° to shed load (try ${tiltAttempt})`,
          "shed",
        );
        const applied = await clockNow();
        const change = await call("ran_tilt_cells", { changes, policy_token: token, reason: `Relieve the neighbours of ${T}` });
        activeTilt = { change_id: String(change.change_id), towers: targets };
        say("apply", `Tilt ${tiltAttempt}: ${targets.join(", ")}`, tiltAttempt);
        await moveIncident("MITIGATING", `Tilted ${targets.join(", ")} down ${TILT_DEG}° (${activeTilt.change_id}).`);

        const failed: string[] = [];
        for (const tower of targets) {
          const after = await loadAfter(tower, applied);
          const ok = after != null && after < THRESHOLD_PRB && after < before[tower] * 0.9;
          say("verify", `${tower}: ${before[tower].toFixed(0)}% to ${after != null ? `${after.toFixed(0)}%` : "no sample"} ${ok ? "(relieved)" : "(not enough)"}`, tiltAttempt);
          if (!ok) failed.push(tower);
        }
        if (!failed.length) break;
        const undo = await authorise(
          "ran_revert_tilt",
          activeTilt.towers,
          0.99,
          "The tilt did not relieve the load",
          `Roll back ${activeTilt.change_id}: ${failed.join(", ")} did not improve`,
        );
        await call("ran_revert_change", { change_id: activeTilt.change_id, policy_token: undo, reason: "Did not improve the KPIs" });
        say("rollback", `Rolled back ${activeTilt.change_id}`, tiltAttempt);
        activeTilt = null;
        targets = tiltAttempt < 2 ? targets : [];
      }
    } else if (status.status === "DOWN") {
      activeTilt = await compensate(dx.confidence);
    } else {
      const peak = Math.max(0, ...neighbours.map((n) => n.prb_util ?? 0));
      say("simulate", `Neighbours have headroom (peak ${peak.toFixed(0)}% PRB): no tilt needed`);
    }

    // ---- fix the tower itself
    let fixed = false;
    if (status.status !== "UP" && dx.remote === "reset") {
      const cell = ((status.cells as string[] | undefined) ?? [])[0];
      const token = await authorise("ran_reset_cell", [T], dx.confidence, dx.why, `Soft-reset cell ${cell} of ${T}`);
      await call("ran_reset_cell", { cell_id: cell, policy_token: token, reason: dx.why });
      say("apply", `Soft reset of ${cell}`);
      const again = await call("tower_get_status", { enodeb_name: T });
      fixed = again.status === "UP";
      say("verify", fixed ? `${T} is UP after the reset` : `${T} is still ${String(again.status)} after the reset`);
    }
    if (status.status !== "UP" && !fixed && dx.skill) {
      if (dx.cause === "FLOOD") {
        const token = await authorise("drone_dispatch", [T], dx.confidence, "Check the access road and the genset", `Send a drone to inspect ${T} before the crew goes`);
        const mission = await call("drone_dispatch", { enodeb_name: T, policy_token: token, reason: "Check the access road and the genset" }).catch(
          (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }) as Data,
        );
        say("apply", mission.error ? `Drone not sent: ${String(mission.error)}` : `Drone ${String(mission.drone_id ?? "")} sent to ${T}`);
      }
      // wait for a crew with the right skill to be on shift
      let waited = 0;
      let crew = await call("field_find_crew", { enodeb_name: T, skill: dx.skill });
      while (!((crew.candidates as unknown[] | undefined) ?? []).length && waited < CREW_WAIT_MAX_MIN) {
        if (waited === 0) say("apply", `No ${dx.skill} crew free right now: waiting for the next shift`);
        await advance(CREW_WAIT_STEP_MIN);
        waited += CREW_WAIT_STEP_MIN;
        crew = await call("field_find_crew", { enodeb_name: T, skill: dx.skill });
      }
      if (waited > 0) say("apply", `A ${dx.skill} crew is free after ${waited} min`);
      const best = ((crew.candidates as { tech_id: string; name: string; eta_min: number; access: string }[] | undefined) ?? [])[0];
      if (!best) {
        say("apply", `No ${dx.skill} crew free within ${CREW_WAIT_MAX_MIN / 60} h`, 0, true);
        await note(`No ${dx.skill} crew became free within ${CREW_WAIT_MAX_MIN / 60} h.`);
        throw new Stopped(`No ${dx.skill} crew became free within ${CREW_WAIT_MAX_MIN / 60} hours; the incident stays open for a person to follow up.`);
      }
      const task = `${dx.why}. Restore ${T}.`.slice(0, 200);
      const token = await authorise(
        "workforce_create_order",
        [T],
        dx.confidence,
        dx.why,
        `Dispatch ${dx.skill} technician ${best.name} to repair the ${dx.problem} at ${T} (ETA ${best.eta_min} min by ${best.access.toLowerCase()})`,
      );
      const job = await call("field_dispatch", { enodeb_name: T, tech_id: best.tech_id, task, policy_token: token, reason: dx.why, skill: dx.skill });
      say("apply", `${best.name} dispatched (${String(job.job_id ?? "")}), ETA ${best.eta_min} min`);
      await moveIncident("MITIGATING", `Crew ${best.name} dispatched (${String(job.job_id ?? "")}).`);
      await advance(Number(job.eta_min ?? best.eta_min));
      say("apply", `${best.name} on site at ${T}`);
      await advance(90);
      const again = await call("tower_get_status", { enodeb_name: T });
      fixed = again.status === "UP";
      say("verify", fixed ? `${T} is UP: the crew finished the repair` : `${T} is still ${String(again.status)}`);
    }

    // ---- recover: undo the temporary tilt once the tower carries its own traffic, then close the incident
    if (fixed || status.status === "UP") {
      if (activeTilt) {
        const token = await authorise("ran_revert_tilt", activeTilt.towers, 0.99, `${T} is back`, `Restore the original tilt of ${activeTilt.towers.join(", ")} now that ${T} is back`);
        await call("ran_revert_change", { change_id: activeTilt.change_id, policy_token: token, reason: `${T} is back` });
        say("rollback", `Original tilt restored (${activeTilt.change_id})`);
      }
      await moveIncident("RESOLVED", `${T} restored by self-heal.`);
      say("recover", `${T} is UP; incident ${incidentId} resolved`);
      let tickets = "";
      if (nttId) {
        await ticketing("recover", `resolve ${nttId}`, async () => {
          // tickets keep arriving while the tower is down: link the late ones so they close with the rest
          const late = await nearbyTickets();
          if (late.length) await call("ticket_link_ctts", { ntt_id: nttId, ctt_ticket_ids: late });
          const done = await call("ticket_resolve_ntt", { ntt_id: nttId, resolution_note: `${T} restored by self-heal: the ${dx.problem} was fixed.`, resolved_by: RESOLVER });
          const closed = ((done.resolved_ctts as string[] | undefined) ?? []).length;
          const mcmc = (done.mcmc as { can_send?: boolean; outage_duration_min?: number } | undefined) ?? {};
          const notice = mcmc.can_send ? "simulated MCMC closure notice recorded" : "no MCMC closure notice needed";
          say("recover", `${nttId} resolved: ${closed} customer ticket${closed === 1 ? "" : "s"} closed; ${notice}`);
          tickets = ` ${nttId} is resolved and ${closed} customer ticket${closed === 1 ? " was" : "s were"} closed with it (${notice}${mcmc.outage_duration_min != null ? ` for a ${mcmc.outage_duration_min} min outage` : ""}).`;
        });
      }
      run.events.push({ type: "final", status: "done", text: `${T} healed: the ${dx.problem} was fixed and incident ${incidentId} is resolved.${tickets} Every action was approved by you. All data is synthetic.` });
    } else {
      const stillOpen = nttId ? `incident ${incidentId} and ${nttId} stay` : `incident ${incidentId} stays`;
      run.events.push({ type: "final", status: "done", text: `${T} is still down; the neighbours were handled and ${stillOpen} open for a person. All data is synthetic.` });
    }
    run.status = "done";
  } catch (error) {
    const stopped = error instanceof Stopped;
    const outcome = run.cancelled ? "cancelled" : stopped ? "stopped" : "error";
    run.events.push({ type: "final", status: outcome, text: error instanceof Error ? error.message : String(error) });
    run.status = outcome;
  } finally {
    run.pending = null;
  }
}

// ---------------------------------------------------------------- chart and map state, read from the servers

type Point = { t_min: number; prb: number };

const safe = async (tool: string, args: Args): Promise<Data> => {
  try {
    return dataOf(await callMenaraTool(tool, args));
  } catch {
    return {};
  }
};

function thin(points: Point[]): Point[] {
  if (points.length <= MAX_POINTS) return points;
  const step = Math.ceil(points.length / MAX_POINTS);
  const kept = points.filter((_, i) => i % step === 0);
  if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]);
  return kept;
}

const minutesFrom = (start: number, stamp: unknown) => (typeof stamp === "string" ? Math.round((Date.parse(stamp) - start) / 60000) : null);

export type HealState = {
  clock_min: number;
  failed_tower: string;
  failed_status: string | null;
  threshold: number;
  watched: string[];
  series: Record<string, Point[]>;
  changes: { change_id: string; status: string; applied_min: number | null; reverted_min: number | null; towers: string[] }[];
  incident: { incident_id: string; status: string } | null;
  run: { id: string; status: Run["status"] } | null;
  /** The faulty tower and its neighbours, for drawing the incident on the map. */
  map: {
    towers: { name: string; lat: number; lng: number; role: "failed" | "neighbour"; status: string; prb_now: number | null; tilted: boolean }[];
  };
};

export async function healState(): Promise<HealState> {
  const run = currentRun();
  const clock = await safe("demo_get_clock", {});
  const clockMin = Number(clock.t_min ?? 0);
  const now = Date.parse(String(clock.at));
  const start = now - clockMin * 60000;

  const failed = run?.tower ?? FLOOD_TOWER;
  const incidents = (((await safe("ontology_list_incidents", { enodeb_name: failed })).incidents as Record<string, string>[] | undefined) ?? []).filter(
    (i) => Date.parse(i.created_at) <= now,
  );
  const latest = [...incidents].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

  const status = await safe("tower_get_status", { enodeb_name: failed });
  const neighbours = ((status.neighbours as { enodeb_name: string; prb_util: number | null }[] | undefined) ?? []).filter((n) => n.enodeb_name !== failed);
  const names = neighbours.map((n) => n.enodeb_name);

  // tilts on this tower's neighbours (resets and other towers' changes are not part of this chart)
  const changes = (((await safe("ran_list_changes", {})).changes as Record<string, unknown>[] | undefined) ?? [])
    .filter((c) => c.action === "ran_tilt_cells" && Date.parse(String(c.applied_at)) <= now)
    .filter((c) => ((c.towers as string[] | undefined) ?? []).some((t) => names.includes(t)))
    .sort((a, b) => String(a.applied_at ?? "").localeCompare(String(b.applied_at ?? "")) || String(a.change_id).localeCompare(String(b.change_id)));
  const changed = new Set(changes.flatMap((c) => (c.towers as string[] | undefined) ?? []));

  // the busiest neighbours and every tilted one
  const watchedNames = [
    ...new Set([...changed, ...[...neighbours].sort((a, b) => (b.prb_util ?? 0) - (a.prb_util ?? 0)).map((n) => n.enodeb_name)]),
  ].slice(0, Math.max(MAX_WATCHED, changed.size));
  const window = Math.min(MAX_WINDOW_MIN, Math.max(5, clockMin + LEAD_MIN));
  const watched: string[] = [];
  const series: Record<string, Point[]> = {};
  for (const tower of watchedNames) {
    const kpi = await safe("tower_get_kpi", { enodeb_name: tower, window_min: window });
    const points = ((kpi.points as { t_min?: number; prb_util: number }[] | undefined) ?? [])
      .filter((p) => p.t_min != null)
      .map((p) => ({ t_min: p.t_min as number, prb: p.prb_util }));
    if (points.length) {
      watched.push(tower);
      series[tower] = thin(points);
    }
  }

  const at = { lat: Number(status.lat), lng: Number(status.lng) };
  const around = Number.isFinite(at.lat)
    ? (((await safe("tower_list_in_radius", { lat: at.lat, lng: at.lng, radius_km: 10, limit: 200 })).towers as
        | { enodeb_name: string; lat: number; lng: number; status: string }[]
        | undefined) ?? [])
    : [];
  const tiltedNow = new Set(changes.filter((c) => c.status === "ACTIVE").flatMap((c) => (c.towers as string[] | undefined) ?? []));
  const prbNow: Record<string, number | null> = Object.fromEntries(neighbours.map((n) => [n.enodeb_name, n.prb_util]));
  prbNow[failed] = (status.latest_kpi as { prb_util?: number } | null | undefined)?.prb_util ?? null; // the tower's own load, 0 while it is down
  const mapTowers = around
    .filter((t) => t.enodeb_name === failed || names.includes(t.enodeb_name))
    .map((t) => ({
      name: t.enodeb_name,
      lat: t.lat,
      lng: t.lng,
      role: (t.enodeb_name === failed ? "failed" : "neighbour") as "failed" | "neighbour",
      status: t.status,
      prb_now: prbNow[t.enodeb_name] ?? null,
      tilted: tiltedNow.has(t.enodeb_name),
    }));

  return {
    map: { towers: mapTowers },
    clock_min: clockMin,
    failed_tower: failed,
    failed_status: (status.status as string | undefined) ?? null,
    threshold: THRESHOLD_PRB,
    watched,
    series,
    changes: changes.map((c) => ({
      change_id: String(c.change_id),
      status: String(c.status),
      applied_min: minutesFrom(start, c.applied_at),
      reverted_min: minutesFrom(start, c.reverted_at),
      towers: (c.towers as string[] | undefined) ?? [],
    })),
    incident: latest ? { incident_id: latest.incident_id, status: latest.status } : null,
    run: run ? { id: run.id, status: run.status } : null,
  };
}
