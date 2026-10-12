/**
 * Order 5.5: the map-aware Agents workspace. A selected map area (drawn shape or clicked tower) travels to Hermes
 * as a structured block in the prompt; after the run, the recorded tool-call arguments decide whether the agents
 * actually stayed inside that area. Evidence rows come only from recorded MCP results and their GeoJSON.
 *
 * Self-contained (no path aliases) so node --test can import it directly.
 */

export type LatLng = { lat: number; lng: number };
export type MapArea = {
  kind: "polygon" | "rectangle" | "circle" | "tower";
  label: string;
  center: LatLng;
  /** Radius of the smallest circle around the centre that holds the whole area. */
  radiusKm: number;
  bbox: [number, number, number, number];
  /** Outer ring for polygons and rectangles, [lng, lat] points. */
  ring?: number[][];
  towerName?: string;
};
export type AreaSite = { site_id: string; lat: number; lng: number };

/** Agents whose tools can be limited to sites or a radius; the Hypothesis agent only reads the national graph. */
export const AREA_SCOPED_AGENTS = ["orchestrator", "engineer", "forecast", "business"] as const;
export const AREA_MARKER = "[MAP SELECTION";
const MAX_PROMPT = 4_000;
const MAX_SITE_IDS = 20;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function inRing(ring: number[][], lat: number, lng: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const round = (value: number, digits = 5) => Number(value.toFixed(digits));

/** An area from a drawn shape's metrics (see boundary-context.ts extractFeatureMetrics). */
export function areaFromShape(shape: string, ring: number[][], label: string): MapArea | null {
  if (ring.length < 3) return null;
  const lngs = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const bbox: [number, number, number, number] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  const center = { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 };
  const radiusKm = Math.max(...ring.map(([lng, lat]) => haversineKm(center, { lat, lng })));
  const s = shape.toLowerCase();
  const kind = s.includes("circle") ? "circle" : s.includes("rect") ? "rectangle" : "polygon";
  return { kind, label, center, radiusKm: round(radiusKm, 2), bbox, ...(kind === "circle" ? {} : { ring }) };
}

/** A clicked tower: the circle of `radiusKm` around it. */
export function areaFromTower(name: string, lat: number, lng: number, radiusKm = 2): MapArea {
  const dLat = radiusKm / 111, dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { kind: "tower", label: `${name} (${radiusKm} km around)`, towerName: name, center: { lat, lng }, radiusKm,
           bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat] };
}

export function areaContains(area: MapArea, lat: number, lng: number): boolean {
  if (area.ring) return inRing(area.ring, lat, lng);
  return haversineKm(area.center, { lat, lng }) <= area.radiusKm + 1e-9;
}

export function sitesInArea<T extends AreaSite>(area: MapArea, sites: T[]): T[] {
  return sites.filter((s) => areaContains(area, s.lat, s.lng)).sort((a, b) => a.site_id.localeCompare(b.site_id));
}

/** The structured block appended to the agent prompt. Site IDs let the Engineer query exactly the area's sites. */
export function areaPromptBlock(area: MapArea, siteIds: string[]): string {
  const ids = siteIds.slice(0, MAX_SITE_IDS);
  const context = {
    kind: area.kind, label: area.label, center: { lat: round(area.center.lat), lng: round(area.center.lng) },
    radius_km: area.radiusKm, bbox: area.bbox.map((v) => round(v)), site_ids: ids, site_count: siteIds.length,
  };
  return `${AREA_MARKER} - structured context; synthetic NetOps data]\n${JSON.stringify(context)}\n` +
    `Scope rule: query only these Site_IDs (site_id) or radius queries centred inside this area with radius <= ${Math.max(1, Math.ceil(area.radiusKm))} km. ` +
    "Say which tool calls were area-scoped. Do not describe sites outside this area as part of it.";
}

export function withAreaContext(prompt: string, area: MapArea | null, siteIds: string[]): string {
  if (!area) return prompt.trim();
  const block = areaPromptBlock(area, siteIds);
  return `${prompt.trim().slice(0, MAX_PROMPT - block.length - 2)}\n\n${block}`;
}

/** The area a saved investigation was asked about, read back from its prompt (null when it had none). */
export function areaFromPrompt(prompt: string): (MapArea & { siteIds: string[] }) | null {
  const at = prompt.indexOf(AREA_MARKER);
  if (at < 0) return null;
  const line = prompt.slice(at).split("\n")[1];
  try {
    const c = JSON.parse(line) as { kind: MapArea["kind"]; label: string; center: LatLng; radius_km: number; bbox: MapArea["bbox"]; site_ids: string[] };
    const [w, so, e, n] = c.bbox;
    const ring = c.kind === "rectangle" ? [[w, so], [e, so], [e, n], [w, n], [w, so]] : undefined;
    return { kind: c.kind, label: c.label, center: c.center, radiusKm: c.radius_km, bbox: c.bbox, siteIds: c.site_ids ?? [], ...(ring ? { ring } : {}) };
  } catch {
    return null;
  }
}

/** The user's request without the appended area block. */
export function promptWithoutArea(prompt: string): string {
  const at = prompt.indexOf(AREA_MARKER);
  return (at < 0 ? prompt : prompt.slice(0, at)).trim();
}

// ---------------------------------------------------------------- did the agents respect the area?

export type ToolCall = { tool: string; ok?: boolean; arguments?: Record<string, unknown>; data?: unknown; executed_at?: string;
                         source?: Record<string, unknown>; [key: string]: unknown };
export type JobLike = {
  investigation_id: string; agent_id: string; status: string; prompt: string; updated_at: string; summary?: string | null;
  tasks: { task_id: string; agent_id: string; status: string; summary?: string | null; warnings?: string[]; tool_calls?: ToolCall[] }[];
  geojson?: { features: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] } | null;
  warnings?: string[]; feasibility?: unknown;
};
/** in_area: provably inside; beyond: centred inside but the search circle reaches past the area; outside; unscoped: no location. */
export type CallScope = "in_area" | "beyond" | "outside" | "unscoped";

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
function idList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** How one tool call relates to the area: by the Site_IDs it named, or by the centre and radius it searched. */
export function callScope(call: ToolCall, area: Pick<MapArea, "center" | "radiusKm"> & Partial<MapArea>, areaSiteIds: Set<string>): CallScope {
  const a = call.arguments ?? {};
  const ids = [...idList(a.site_id), ...idList(a.site_ids), ...idList(a.site), ...idList(a.sites)];
  if (ids.length) return ids.every((id) => areaSiteIds.has(id.toUpperCase())) ? "in_area" : "outside";
  const lat = num(a.lat ?? a.latitude ?? a.current_lat), lng = num(a.lng ?? a.lon ?? a.longitude ?? a.current_long);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const radius = num(a.radius_km ?? a.radius);
    const r = Number.isFinite(radius) && radius > 0 ? radius : 0;
    if (area.ring) {
      if (!inRing(area.ring, lat, lng)) return "outside";
      // the whole search circle must lie in the shape: sample its edge (24 points)
      const dLat = r / 111, dLng = r / (111 * Math.cos((lat * Math.PI) / 180));
      const edgeInside = Array.from({ length: 24 }, (_, i) => (2 * Math.PI * i) / 24)
        .every((t) => inRing(area.ring!, lat + dLat * Math.sin(t), lng + dLng * Math.cos(t)));
      return edgeInside ? "in_area" : "beyond";
    }
    const d = haversineKm(area.center, { lat, lng });
    if (d > area.radiusKm) return "outside";
    // a polygon known only by its bounding box cannot prove a radius search stays inside it
    if (area.kind === "polygon" && r > 0) return "beyond";
    return d + r <= area.radiusKm + 1e-9 ? "in_area" : "beyond";
  }
  return "unscoped";
}

export type Adherence = {
  verdict: "respected" | "partly respected" | "not area-scoped" | "no tool calls";
  inArea: number; beyond: number; outside: number; unscoped: number;
  calls: { agent: string; tool: string; scope: CallScope }[];
};

/** Only successful, recorded calls count. "respected" needs every call to stay in the area. */
export function areaAdherence(job: JobLike, area: Pick<MapArea, "center" | "radiusKm"> & Partial<MapArea>, siteIds: string[]): Adherence {
  const ids = new Set(siteIds.map((s) => s.toUpperCase()));
  const calls = job.tasks.flatMap((t) => (t.tool_calls ?? []).filter((c) => c.ok === true && c.tool !== "delegate_specialist")
    .map((c) => ({ agent: t.agent_id, tool: c.tool, scope: callScope(c, area, ids) })));
  const count = (s: CallScope) => calls.filter((c) => c.scope === s).length;
  const inArea = count("in_area"), beyond = count("beyond"), outside = count("outside"), unscoped = count("unscoped");
  const verdict = !calls.length ? "no tool calls" : inArea === calls.length ? "respected" : inArea > 0 ? "partly respected" : "not area-scoped";
  return { verdict, inArea, beyond, outside, unscoped, calls };
}

// ---------------------------------------------------------------- evidence rows

export type EvidenceRow = {
  key: string; agent: string; tool: string; service: string; reference: string; synthetic: boolean;
  siteId: string | null; label: string; metrics: { name: string; value: number | string }[]; at: string | null;
  lat: number | null; lng: number | null;
};

const ID_KEYS = ["site_id", "Site_ID", "siteId", "site", "cell_name", "Cell_Name", "enodeb_name", "ntt_no", "ticket_id", "id"];
const SKIP = /^(lat|lng|lon|latitude|longitude|page|page_size|total_pages|total|cells|count|.*_id|id|rank|azimuth)$/i;
const TIME = /(date|time|period|_at$|_utc$|^ts|day)/i;

function records(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    const objects = value.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v));
    if (objects.length && objects.some((o) => ID_KEYS.some((k) => k in o))) return objects;
    for (const v of value) { const found = records(v, depth + 1); if (found.length) return found; }
    return [];
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "geojson" || k === "evidence") continue;
    const found = records(v, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function short(v: number) { return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100; }

/** One row per record a successful MCP call returned (bounded), plus each GeoJSON feature the run mapped. */
export function evidenceRows(job: JobLike, siteCoords: Map<string, LatLng> = new Map(), limit = 150): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  const featureAt = new Map<string, LatLng>();
  for (const f of job.geojson?.features ?? []) {
    const id = ID_KEYS.map((k) => f.properties[k]).find((v) => typeof v === "string") as string | undefined;
    if (id) featureAt.set(id.toUpperCase(), { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
  }
  for (const task of job.tasks) {
    for (const [index, call] of (task.tool_calls ?? []).entries()) {
      if (call.ok !== true || call.tool === "delegate_specialist") continue;
      const source = call.source ?? {};
      const base = { agent: task.agent_id, tool: call.tool, service: String(source.service ?? "mcp"),
                     reference: String(source.reference ?? `${task.task_id}:${index + 1}`), synthetic: source.synthetic !== false };
      const found = records(call.data);
      if (!found.length) {
        // e.g. a ticket search that matched nothing: keep its counts, which are evidence too
        const top = call.data && typeof call.data === "object" ? Object.entries(call.data as Record<string, unknown>) : [];
        const metrics = top.filter(([k, v]) => typeof v === "number" && !/^(page|page_size|total_pages)$/.test(k)).slice(0, 3)
          .map(([name, v]) => ({ name, value: short(v as number) }));
        const empty = top.some(([k, v]) => (k === "total" || k === "items") && (v === 0 || (Array.isArray(v) && !v.length)));
        rows.push({ ...base, key: `${base.reference}`, siteId: null, label: empty ? "No matching records" : "Result without per-site records", metrics,
                    at: call.executed_at ?? null, lat: null, lng: null });
        continue;
      }
      for (const [i, r] of found.slice(0, 40).entries()) {
        const siteRaw = ["site_id", "Site_ID", "siteId", "site"].map((k) => r[k]).find((v) => typeof v === "string") as string | undefined;
        const label = String(ID_KEYS.map((k) => r[k]).find((v) => v !== undefined && v !== null) ?? "record");
        const metrics: EvidenceRow["metrics"] = Object.entries(r).filter(([k, v]) => !SKIP.test(k) && !TIME.test(k) && typeof v === "number" && Number.isFinite(v))
          .slice(0, 3).map(([name, v]) => ({ name, value: short(v as number) }));
        if (!metrics.length) {
          const text = Object.entries(r).find(([k, v]) => /status|severity|fault|level|title/i.test(k) && typeof v === "string");
          if (text) metrics.push({ name: text[0], value: String(text[1]).slice(0, 40) });
        }
        const at = Object.entries(r).find(([k, v]) => TIME.test(k) && typeof v === "string")?.[1] as string | undefined;
        const site = siteRaw?.toUpperCase() ?? null;
        const latR = num(r.lat ?? r.latitude), lngR = num(r.lng ?? r.lon ?? r.longitude);
        const where = Number.isFinite(latR) && Number.isFinite(lngR) ? { lat: latR, lng: lngR }
          : (site && (siteCoords.get(site) ?? featureAt.get(site))) || featureAt.get(label.toUpperCase()) || null;
        rows.push({ ...base, key: `${base.reference}#${i}`, siteId: site, label, metrics, at: at ?? call.executed_at ?? null,
                    lat: where?.lat ?? null, lng: where?.lng ?? null });
        if (rows.length >= limit) return rows;
      }
    }
  }
  return rows;
}

/** Evidence rows for a clicked tower: the same site, or anything recorded within `km` of it. */
export function evidenceNear(rows: EvidenceRow[], point: LatLng & { name?: string }, km = 1.5): EvidenceRow[] {
  return rows.filter((r) => (point.name && r.siteId === point.name.toUpperCase())
    || (r.lat !== null && r.lng !== null && haversineKm(point, { lat: r.lat, lng: r.lng }) <= km));
}

// ---------------------------------------------------------------- Summary and Report

export type JobDigest = {
  headline: string; recommendation: string | null; risk: "high" | "medium" | "low" | "unknown"; riskBasis: string;
  agents: string[]; okCalls: number; failedCalls: number; tools: string[]; sites: string[];
};

const RECOMMEND = /\b(recommend|should|next step|action|prioriti[sz]e|dispatch|check|investigate)\b/i;
const META = /^(investigation id|task id|area scope|agent|status|date|time|scope)\b[^:]*:/i;

/** Agent markdown as plain text: no heading marks, emphasis, code ticks or table rules. */
export function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, "").replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, "").trim();
}

/** Prose sentences of an agent report, skipping headings and ID/metadata lines. */
function sentences(text: string): string[] {
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => plain(l).replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l && !META.test(l) && !/:$/.test(l));
  return lines.join(" ").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter((s) => s.length > 3);
}

export function digest(job: JobLike, rows: EvidenceRow[]): JobDigest {
  const text = job.summary ?? job.tasks.find((t) => t.summary)?.summary ?? "";
  const lines = sentences(text);
  const calls = job.tasks.flatMap((t) => t.tool_calls ?? []).filter((c) => c.tool !== "delegate_specialist");
  const severities = (job.geojson?.features ?? []).map((f) => String(f.properties.severity ?? f.properties.risk_level ?? "").toUpperCase());
  const verdicts = Array.isArray(job.feasibility) ? (job.feasibility as { label?: string }[]).map((v) => v.label ?? "") : [];
  let risk: JobDigest["risk"] = "unknown", riskBasis = "No severity, verdict or KPI threshold in the recorded results.";
  const kpi = kpiBreaches(job);
  if (verdicts.length) {
    risk = verdicts.some((v) => v.startsWith("blocked")) ? "high" : verdicts.some((v) => v.includes("risk")) ? "medium" : "low";
    riskBasis = `Hermes feasibility verdicts: ${verdicts.join(", ")}`;
  } else if (severities.some(Boolean)) {
    risk = severities.some((s) => s === "HIGH" || s === "CRITICAL") ? "high" : severities.some((s) => s === "MEDIUM") ? "medium" : "low";
    riskBasis = `Severity of ${severities.filter(Boolean).length} mapped findings from tool results`;
  } else if (kpi.checked) {
    risk = kpi.severe ? "high" : kpi.breaches ? "medium" : "low";
    riskBasis = `${kpi.breaches} of ${kpi.checked} site KPI values breach NetOps thresholds (get_ran_kpi)`;
  }
  return {
    headline: lines.slice(0, 2).join(" ") || (job.status === "failed" ? "The investigation did not complete." : "No summary yet."),
    recommendation: lines.find((l) => RECOMMEND.test(l)) ?? null, risk, riskBasis,
    agents: [...new Set(job.tasks.map((t) => t.agent_id))],
    okCalls: calls.filter((c) => c.ok === true).length, failedCalls: calls.filter((c) => c.ok === false).length,
    tools: [...new Set(calls.filter((c) => c.ok === true).map((c) => c.tool))],
    sites: [...new Set(rows.map((r) => r.siteId).filter((s): s is string => Boolean(s)))].sort(),
  };
}

/** Recorded get_ran_kpi values against the thresholds NetOps returned with them (direction "lower"/"higher" is better). */
export function kpiBreaches(job: JobLike): { checked: number; breaches: number; severe: boolean } {
  let checked = 0, breaches = 0, severe = false;
  for (const call of job.tasks.flatMap((t) => t.tool_calls ?? [])) {
    if (call.tool !== "get_ran_kpi" || call.ok !== true || !call.data || typeof call.data !== "object") continue;
    const d = call.data as { kpis?: { kpi: string; threshold?: number; direction?: string }[]; series?: Record<string, unknown>[] };
    for (const k of d.kpis ?? []) {
      if (typeof k.threshold !== "number") continue;
      for (const row of d.series ?? []) {
        const v = row[k.kpi];
        if (typeof v !== "number") continue;
        checked += 1;
        const bad = k.direction === "lower" ? v > k.threshold : v < k.threshold;
        if (bad) breaches += 1;
        if (bad && k.kpi.includes("availability") && v < 95) severe = true;
      }
    }
  }
  return { checked, breaches, severe };
}
