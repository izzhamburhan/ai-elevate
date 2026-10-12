/**
 * A tower picked on the map, written up as chat context. It rides with the next message as a file
 * part of its own media type: the chat shows it as a chip (in the composer and in the sent message,
 * also after a reload) and the chat route hands its text to the model. The facts come from the
 * tower MCP when it answers; otherwise from what the map row already had. All data is synthetic.
 */

/** Media type of a tower context attachment. */
export const TOWER_MEDIA_TYPE = "text/x-elevate-tower";

/** The composer attachment that carries a tower's context. */
export function towerAttachment(name: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  const data = `data:${TOWER_MEDIA_TYPE};base64,${btoa(String.fromCharCode(...bytes))}`;
  return {
    id: `tower-${name}-${Date.now().toString(36)}`,
    type: "file",
    name,
    contentType: TOWER_MEDIA_TYPE,
    content: [{ type: "file" as const, mimeType: TOWER_MEDIA_TYPE, filename: name, data }],
  };
}

/** The context text inside a tower attachment's data URL ("" when it isn't one). */
export function readTowerContext(dataUrl: string) {
  const prefix = `data:${TOWER_MEDIA_TYPE};base64,`;
  if (!dataUrl.startsWith(prefix)) return "";
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(dataUrl.slice(prefix.length)), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

/** Tower names in the scenario look like BANG-5363 or KKRI-0142. */
const TOWER_NAME = /^[A-Z]{2,6}-\d{2,6}$/;

export const isTowerName = (value: unknown): value is string => typeof value === "string" && TOWER_NAME.test(value);

/** What a map row knows about a tower; enough for a fallback when the tower MCP is unreachable. */
export type TowerRow = { name: string; town?: string; state?: string; status?: string; lat?: number; lng?: number };

type Neighbour = { enodeb_name: string; distance_km: number; status: string; prb_util: number | null };
type Kpi = { at: string; prb_util: number; drop_rate: number; throughput_mbps: number };
type Detail = {
  enodeb_name: string;
  site_id: string;
  town: string;
  state: string;
  lat: number;
  lng: number;
  tower_type: string;
  vendor: string;
  firmware: string;
  status: string;
  battery_pct: number | null;
  mains_ok: boolean | null;
  cells: string[];
  latest_kpi: Kpi | null;
  neighbours: Neighbour[];
};
type Alarm = { code: string; severity: string; message: string; raised_at: string };

async function menara<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/menara/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok || !body.data) throw new Error(body.error ?? `${tool} failed (${res.status})`);
  return body.data;
}

const MYT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const when = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${MYT.format(t)} MYT` : iso;
};

function power(d: Detail) {
  const mains = d.mains_ok == null ? null : d.mains_ok ? "mains on" : "mains off";
  const battery = d.battery_pct == null ? null : `battery ${Math.round(d.battery_pct)}%`;
  return [mains, battery].filter(Boolean).join(", ");
}

function neighbours(list: Neighbour[]) {
  if (!list.length) return null;
  const counts = Object.entries(
    list.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.status]: (acc[n.status] ?? 0) + 1 }), {}),
  )
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  const busiest = [...list].filter((n) => n.prb_util != null).sort((a, b) => (b.prb_util ?? 0) - (a.prb_util ?? 0))[0];
  const peak = busiest ? `; busiest ${busiest.enodeb_name} at ${busiest.prb_util!.toFixed(0)}% PRB (${busiest.distance_km.toFixed(1)} km)` : "";
  return `Neighbours (${list.length}): ${counts}${peak}`;
}

/** The context block for one tower, from the tower MCP, or from the map row when it can't be reached. */
export async function towerContext(row: TowerRow): Promise<string> {
  const [detail, alarms] = await Promise.all([
    menara<Detail>("tower_get_status", { enodeb_name: row.name }).catch(() => null),
    menara<{ alarms: Alarm[] }>("tower_get_alarms", { enodeb_name: row.name, active_only: true, limit: 5 })
      .then((r) => r.alarms)
      .catch(() => null),
  ]);

  const lines = [`Map context: tower ${row.name}, picked by the user on the map (synthetic data).`];
  if (!detail) {
    const place = [row.town, row.state].filter(Boolean).join(", ");
    if (place) lines.push(`- Place: ${place}`);
    if (row.lat != null && row.lng != null) lines.push(`- Location: ${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`);
    if (row.status) lines.push(`- Status on the map: ${row.status}`);
    lines.push("- The tower feed did not answer; look the tower up with the tools for more.");
    return lines.join("\n");
  }

  lines.push(`- Site ${detail.site_id}, ${detail.town}, ${detail.state} · ${detail.lat.toFixed(4)}, ${detail.lng.toFixed(4)}`);
  lines.push(`- ${detail.tower_type} · ${detail.vendor} · firmware ${detail.firmware} · cells ${detail.cells.join(", ") || "none"}`);
  const p = power(detail);
  lines.push(`- Status: ${detail.status}${p ? ` · ${p}` : ""}`);
  if (alarms?.length) {
    lines.push(`- Active alarms (${alarms.length}): ${alarms.map((a) => `${a.severity} ${a.code} "${a.message}" since ${when(a.raised_at)}`).join("; ")}`);
  } else if (alarms) {
    lines.push("- No active alarms");
  }
  const k = detail.latest_kpi;
  if (k) lines.push(`- Latest KPI (${when(k.at)}): PRB ${k.prb_util.toFixed(0)}% · drop ${k.drop_rate.toFixed(2)}% · ${k.throughput_mbps.toFixed(0)} Mbps`);
  const n = neighbours(detail.neighbours);
  if (n) lines.push(`- ${n}`);
  return lines.join("\n");
}