"use client";

import { useEffect, useRef } from "react";
import { Activity, AlertTriangle, CloudRain, Gauge, Network, Radio, ShieldAlert, Store, Users, Wrench } from "lucide-react";

import { useMapDraw } from "@/lib/menara/map-draw";
import { cn } from "@/lib/utils";

/**
 * Card for the network-intelligence tools (backend/netintel-mcp) and the ML prediction tools (backend/mlpredict-mcp). The
 * tools run on the server; this only renders their result: the summary, the ranked findings, and the result's GeoJSON
 * drawn on the map (points by severity, sector and transport lines). Every value comes from the tool result.
 */

type Feature = {
  geometry: { type: "Point" | "LineString"; coordinates: number[] | number[][] };
  properties: { id: string | null; kind: string | null; severity: Severity | null; label: string | null };
};
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Envelope = { synthetic?: boolean; as_of?: string; warnings?: string[]; data?: Record<string, unknown> & { summary?: string; geojson?: { features?: Feature[] } } };

export const INTEL_TOOLS = [
  "investigate_customer_complaint",
  "analyze_network_congestion",
  "correlate_network_incidents",
  "assess_weather_network_exposure",
  "recommend_network_maintenance",
  "predict_area_footfall",
  "rank_business_locations",
  "predict_site_failure_risk",
  "forecast_network_congestion",
  "detect_network_anomalies",
] as const;
export type IntelTool = (typeof INTEL_TOOLS)[number];

const TITLES: Record<IntelTool, { title: string; icon: typeof Activity }> = {
  investigate_customer_complaint: { title: "Complaint investigation", icon: AlertTriangle },
  analyze_network_congestion: { title: "Congestion", icon: Activity },
  correlate_network_incidents: { title: "Incident correlation", icon: Network },
  assess_weather_network_exposure: { title: "Weather exposure", icon: CloudRain },
  recommend_network_maintenance: { title: "Maintenance recommendations", icon: Wrench },
  predict_area_footfall: { title: "Footfall forecast", icon: Users },
  rank_business_locations: { title: "Booth locations", icon: Store },
  predict_site_failure_risk: { title: "Site outage risk (24 h)", icon: ShieldAlert },
  forecast_network_congestion: { title: "Congestion forecast", icon: Gauge },
  detect_network_anomalies: { title: "Network anomalies", icon: Activity },
};

export const SEVERITY_COLOR: Record<Severity | "NONE", string> = {
  CRITICAL: "#dc2626",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#22c55e",
  NONE: "#94a3b8",
};
const KIND_COLOR: Record<string, string> = { complaint: "#ec4899", event: "#a855f7", hub: "#38bdf8" };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("en-MY");

/** The tool's envelope from an MCP call result (structured content, or the JSON text block). */
export function intelEnvelope(result: unknown): Envelope | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { structuredContent?: unknown; content?: { type: string; text?: string }[]; data?: unknown };
  if (r.data && typeof r.data === "object") return r as Envelope;
  if (r.structuredContent && typeof r.structuredContent === "object") return r.structuredContent as Envelope;
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    return null;
  }
}

// several cards can mount at once (one answer, or a reloaded chat): only the newest one draws on the map
let latestDraw = 0;

function useDrawFeatures(features: Feature[]) {
  const draw = useMapDraw();
  const drawn = useRef(false);
  useEffect(() => {
    if (drawn.current || !features.length) return;
    const points = new Map<string, { label: string; color: string; radius: number; rows: Record<string, unknown>[] }>();
    const lines = new Map<string, { label: string; color: string; rows: Record<string, unknown>[] }>();
    const lats: number[] = [];
    const lngs: number[] = [];
    for (const f of features) {
      const p = f.properties;
      const kind = p.kind ?? "item";
      const color = KIND_COLOR[kind] ?? SEVERITY_COLOR[p.severity ?? "NONE"];
      if (f.geometry.type === "Point") {
        const [lng, lat] = f.geometry.coordinates as number[];
        lats.push(lat);
        lngs.push(lng);
        const key = `${kind}_${p.severity ?? "none"}`;
        const group = points.get(key) ?? { label: `${kind}${p.severity ? ` · ${p.severity.toLowerCase()}` : ""}`, color, radius: kind === "site" ? 45 : 35, rows: [] };
        group.rows.push({ lat, lng, id: p.id ?? "", label: p.label ?? "" });
        points.set(key, group);
      } else {
        const [[lng0, lat0], [lng1, lat1]] = f.geometry.coordinates as number[][];
        lats.push(lat0, lat1);
        lngs.push(lng0, lng1);
        const key = `${kind}_${p.severity ?? "none"}`;
        const group = lines.get(key) ?? { label: `${kind}${p.severity ? ` · ${p.severity.toLowerCase()}` : ""}`, color: kind === "transport_link" ? "#38bdf8" : color, rows: [] };
        group.rows.push({ lat0, lng0, lat1, lng1, id: p.id ?? "", label: p.label ?? "" });
        lines.set(key, group);
      }
    }
    const mine = ++latestDraw;
    const timer = setTimeout(() => {
      drawn.current = true;
      void (async () => {
        if (mine !== latestDraw) return;
        draw.removeOurs(["intel_"]);
        for (const [key, g] of lines) {
          if (mine !== latestDraw) return;
          await draw.addLines(`intel_l_${key}`, g.label, g.rows, g.color, 3);
        }
        for (const [key, g] of points) {
          if (mine !== latestDraw) return;
          await draw.addPoints(`intel_p_${key}`, g.label, g.rows, g.color, g.radius);
        }
        if (lats.length && mine === latestDraw) draw.fit([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [features, draw]);
}

function Pill({ severity }: { severity: string | null | undefined }) {
  const s = (severity ?? "NONE") as Severity | "NONE";
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: SEVERITY_COLOR[s] ?? SEVERITY_COLOR.NONE }}>
      {severity ?? "n/a"}
    </span>
  );
}

function Rows({ tool, data }: { tool: IntelTool; data: Record<string, unknown> }) {
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as Record<string, unknown>[]) : []);
  if (tool === "investigate_customer_complaint") {
    return (
      <ul className="flex flex-col gap-1">
        {list("causes").slice(0, 4).map((c) => (
          <li key={String(c.cause)} className="rounded-lg border bg-card px-2 py-1.5">
            <div className="flex items-center gap-2 font-medium">
              {String(c.cause).replaceAll("_", " ")}
              <span className="ml-auto text-[11px] text-muted-foreground">{String(c.likelihood)}</span>
            </div>
            {(c.evidence as string[] | undefined)?.slice(0, 2).map((e) => (
              <p key={e} className="text-[11px] text-muted-foreground">
                {e}
              </p>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  if (tool === "analyze_network_congestion") {
    return (
      <ul className="flex flex-col gap-1">
        {list("cells").slice(0, 6).map((c) => (
          <li key={String(c.cell_name)} className="flex items-center gap-2">
            <Pill severity={c.severity as string} />
            <span className="truncate font-medium">{String(c.cell_name)}</span>
            <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
              {String(c.congested_hours)} h · busy {String(c.busy_hour_myt)}:00
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (tool === "correlate_network_incidents") {
    return (
      <ul className="flex flex-col gap-1">
        {list("hypotheses").slice(0, 4).map((h) => (
          <li key={String(h.hypothesis)} className="rounded-lg border bg-card px-2 py-1.5">
            <div className="flex items-center gap-2 font-medium">
              {String(h.hypothesis)}
              <span className="ml-auto text-[11px] text-muted-foreground">{String(h.strength)}</span>
            </div>
            {[...((h.supporting as string[]) ?? []), ...((h.contradicting as string[]) ?? [])].slice(0, 2).map((e) => (
              <p key={e} className="text-[11px] text-muted-foreground">
                {e}
              </p>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  if (tool === "assess_weather_network_exposure") {
    return (
      <ul className="flex flex-col gap-1">
        {list("sites").slice(0, 8).map((s) => {
          const w = s.weather as Record<string, unknown> | null;
          return (
            <li key={String(s.site_id)} className="flex items-center gap-2">
              <Pill severity={(s.exposure_indicator as string) ?? null} />
              <span className="font-medium">{String(s.site_id)}</span>
              <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                {w ? `${Number(w.peak_rainfall_mm).toFixed(2)} mm/h peak` : "no forecast"} · vuln {String((s.vulnerability as { score: number }).score)}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (tool === "predict_area_footfall") {
    return (
      <ul className="flex flex-col gap-1">
        {list("areas").slice(0, 6).map((a) => {
          const v = a.expected_visitors as { p10: number; p50: number; p90: number };
          return (
            <li key={String(a.area_id)} className="flex items-center gap-2">
              <span className="truncate font-medium">{String(a.name)}</span>
              <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                ~{fmt(v.p50)} ({fmt(v.p10)}–{fmt(v.p90)}){(a.events as unknown[]).length ? " · event" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (tool === "rank_business_locations") {
    return (
      <ul className="flex flex-col gap-1">
        {list("recommendations").map((r, i) => (
          <li key={String(r.area_id)} className="rounded-lg border bg-card px-2 py-1.5">
            <div className="flex items-center gap-2 font-medium">
              #{i + 1} {String(r.name)}
              <span className="ml-auto text-[11px] text-muted-foreground">
                ~{String(r.expected_signups)} sign-ups ({(r.signups_band as number[]).join("–")})
              </span>
            </div>
            {[...(r.ranking_factors as string[]).slice(0, 2), ...(r.risks as string[]).slice(0, 1)].map((e) => (
              <p key={e} className="text-[11px] text-muted-foreground">
                {e}
              </p>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  if (tool === "predict_site_failure_risk") {
    return (
      <ul className="flex flex-col gap-1">
        {list("sites").slice(0, 6).map((s) => (
          <li key={String(s.site_id)} className="flex items-center gap-2">
            <Pill severity={s.risk_level as string} />
            <span className="font-medium">{String(s.site_id)}</span>
            <span className="ml-auto truncate text-[11px] text-muted-foreground">
              {(Number(s.risk_score) * 100).toFixed(1)}% · {(s.contributing_factors as { feature: string }[]).map((f) => f.feature).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (tool === "forecast_network_congestion") {
    return (
      <ul className="flex flex-col gap-1">
        {list("cells").slice(0, 6).map((c) => (
          <li key={String(c.cell_name)} className="flex items-center gap-2">
            <Pill severity={c.risk as string} />
            <span className="truncate font-medium">{String(c.cell_name)}</span>
            <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
              peak {String(c.forecast_peak_prb_pct)}% · {String(c.hours_at_or_above_threshold)} h
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (tool === "detect_network_anomalies") {
    return (
      <ul className="flex flex-col gap-1">
        {list("sites").slice(0, 6).map((s) => {
          const worst = s.worst as { cell_name: string; at: { myt: string } } | null;
          return (
            <li key={String(s.site_id)} className="flex items-center gap-2">
              <Pill severity={s.severity as string} />
              <span className="font-medium">{String(s.site_id)}</span>
              <span className="ml-auto truncate text-[11px] text-muted-foreground">
                {String(s.anomalous_cell_hours)} cell-h · {worst ? worst.at.myt.slice(5, 16).replace("T", " ") : ""}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {list("recommendations").slice(0, 6).map((r, i) => (
        <li key={`${String(r.site_id)}-${i}`} className="rounded-lg border bg-card px-2 py-1.5">
          <div className="flex items-center gap-2 font-medium">
            <span className="rounded bg-muted px-1 text-[10px]">{String(r.priority)}</span>
            {String(r.site_id)} · {String(r.category).replaceAll("_", " ")}
          </div>
          <p className="text-[11px] text-muted-foreground">{String(r.action)}</p>
        </li>
      ))}
    </ul>
  );
}

export function IntelCard({ tool, result }: { tool: IntelTool; result: unknown }) {
  const envelope = intelEnvelope(result);
  const data = envelope?.data;
  const features = data?.geojson?.features ?? [];
  useDrawFeatures(features);
  const { title, icon: Icon } = TITLES[tool];

  if (!data) {
    const text = (result as { content?: { text?: string }[] })?.content?.[0]?.text;
    return <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{text ?? "No result."}</p>;
  }
  const provenance = data.provenance as { generator_version?: string; netops_ref_date?: string } | undefined;
  const limitations = (data.limitations as string[] | undefined) ?? [];
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card/40 p-3 font-sans text-[12px] text-foreground">
      <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
        <Icon className="size-4 text-primary" /> {title}
      </h2>
      <p className="leading-5">{data.summary}</p>
      <Rows tool={tool} data={data} />
      {envelope?.warnings?.length ? (
        <ul className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          {envelope.warnings.slice(0, 3).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {features.length ? (
        <p className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground")}>
          <Radio className="size-3.5" /> {features.length} items drawn on the map, coloured by severity.
        </p>
      ) : null}
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Limits and data source</summary>
        <ul className="mt-1 list-disc pl-4">
          {limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-1">
          {provenance?.generator_version
            ? `Synthetic data (${provenance.generator_version}, NetOps ${provenance.netops_ref_date ?? ""}). Rule-based analysis; no model invented these numbers.`
            : "Synthetic data. Local ML models (LightGBM / Isolation Forest); no LLM produced these numbers."}
        </p>
      </details>
    </div>
  );
}
