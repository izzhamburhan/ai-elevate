import { z } from "zod";

/**
 * Named map scenes: a camera, a basemap, which layers show and which filters apply. A scene keeps
 * references (layer and dataset ids), never data, so restoring one can't resurrect a dataset the
 * map no longer has. `planSceneRestore` matches each reference against the map as it is and
 * reports what it could not restore instead of breaking. Pure: no kepler or browser imports.
 */

const cameraSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoom: z.number().min(0).max(24),
  pitch: z.number().min(0).max(85).default(0),
  bearing: z.number().min(-360).max(360).default(0),
});
export type Camera = z.infer<typeof cameraSchema>;

const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  createdAt: z.number(),
  camera: cameraSchema,
  basemap: z.string().max(64).optional(),
  layers: z
    .array(z.object({ id: z.string().max(128), dataId: z.string().max(128), label: z.string().max(200), isVisible: z.boolean() }))
    .max(64),
  filters: z.array(z.object({ dataId: z.string().max(128), field: z.string().max(128), value: z.unknown() })).max(32),
});
export type MapScene = z.infer<typeof sceneSchema>;

export const MAX_SCENES = 24;

/** Scenes from storage; anything malformed is dropped rather than half-restored. */
export function parseScenes(raw: unknown): MapScene[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = sceneSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, MAX_SCENES);
}

/** The bits of a kepler instance a scene reads. */
export type SceneSource = {
  mapState: Camera;
  mapStyle?: { styleType?: string };
  visState: {
    layers: { id: string; config: { dataId: string; label?: string; isVisible: boolean } }[];
    filters: { dataId: string[] | string; name: string[] | string; value: unknown }[];
  };
};

const first = <T,>(value: T[] | T) => (Array.isArray(value) ? value[0] : value);
const round = (value: number, digits = 5) => Math.round(value * 10 ** digits) / 10 ** digits;

export function captureScene(source: SceneSource, name: string, id: string, now: number): MapScene {
  const { latitude, longitude, zoom, pitch, bearing } = source.mapState;
  return sceneSchema.parse({
    id,
    name: name.trim().slice(0, 60) || "Untitled scene",
    createdAt: now,
    camera: { latitude: round(latitude), longitude: round(longitude), zoom: round(zoom, 3), pitch: round(pitch ?? 0, 2), bearing: round(bearing ?? 0, 2) },
    basemap: source.mapStyle?.styleType,
    layers: source.visState.layers.map((l) => ({ id: l.id, dataId: l.config.dataId, label: l.config.label ?? l.id, isVisible: l.config.isVisible })),
    filters: source.visState.filters.flatMap((f) => {
      const dataId = first(f.dataId);
      const field = first(f.name);
      return dataId && field ? [{ dataId, field, value: f.value }] : [];
    }),
  });
}

/** What the map has now, for matching a scene's references. */
export type MapInventory = {
  layers: { id: string; dataId: string; label?: string }[];
  datasets: { id: string; fields: string[] }[];
  basemaps: string[];
};

export type RestorePlan = {
  camera: Camera;
  basemap?: string;
  /** Layers on the map now, by their current id, with the visibility the scene gives them. */
  layers: { layerId: string; isVisible: boolean }[];
  filters: { dataId: string; field: string; value: unknown }[];
  missingLayers: string[];
  missingFilters: string[];
  /** True when the basemap was saved but isn't offered any more. */
  missingBasemap: boolean;
};

/**
 * Matches a scene to the map: a layer by its id, else by dataset and label (a chat recreates
 * layers under new ids). References with no match are listed, never applied.
 */
export function planSceneRestore(scene: MapScene, map: MapInventory): RestorePlan {
  const used = new Set<string>();
  const layers: RestorePlan["layers"] = [];
  const missingLayers: string[] = [];
  for (const saved of scene.layers) {
    const match =
      map.layers.find((l) => l.id === saved.id && !used.has(l.id)) ??
      map.layers.find((l) => l.dataId === saved.dataId && (l.label ?? l.id) === saved.label && !used.has(l.id));
    if (!match) {
      missingLayers.push(saved.label);
      continue;
    }
    used.add(match.id);
    layers.push({ layerId: match.id, isVisible: saved.isVisible });
  }

  const filters: RestorePlan["filters"] = [];
  const missingFilters: string[] = [];
  for (const filter of scene.filters) {
    const dataset = map.datasets.find((d) => d.id === filter.dataId);
    if (dataset?.fields.includes(filter.field)) filters.push(filter);
    else missingFilters.push(filter.field);
  }

  const basemapKnown = !scene.basemap || map.basemaps.includes(scene.basemap);
  return {
    camera: scene.camera,
    basemap: basemapKnown ? scene.basemap : undefined,
    layers,
    filters,
    missingLayers,
    missingFilters,
    missingBasemap: !basemapKnown,
  };
}

/** How many of a scene's layer and filter references the map can honour right now. */
export function sceneCoverage(scene: MapScene, map: MapInventory) {
  const plan = planSceneRestore(scene, map);
  const total = scene.layers.length + scene.filters.length;
  const found = plan.layers.length + plan.filters.length;
  return { found, total, complete: found === total && !plan.missingBasemap };
}

// ---------------------------------------------------------------------------------------------
// Regions: camera-only presets, always restorable

export type Region = { id: string; name: string; caption: string; bounds: [number, number, number, number] };

/** [minLng, minLat, maxLng, maxLat], framed with the side panel's width taken off the left. */
export const REGIONS: Region[] = [
  { id: "malaysia", name: "Malaysia", caption: "Peninsula, Sabah and Sarawak", bounds: [99.6, 0.85, 119.3, 7.4] },
  { id: "peninsula", name: "Peninsular Malaysia", caption: "Eleven states and two territories", bounds: [99.6, 1.25, 104.4, 6.75] },
  { id: "klang-valley", name: "Klang Valley", caption: "Kuala Lumpur, Putrajaya and Selangor", bounds: [101.3, 2.8, 101.85, 3.35] },
  { id: "east-coast", name: "East Coast", caption: "Kelantan, Terengganu and Pahang", bounds: [101.9, 3.6, 103.6, 6.3] },
  { id: "north", name: "Northern corridor", caption: "Perlis, Kedah, Penang and Perak", bounds: [99.6, 4.0, 101.3, 6.75] },
  { id: "south", name: "Southern corridor", caption: "Johor, Melaka and Negeri Sembilan", bounds: [101.7, 1.25, 104.4, 3.0] },
  { id: "borneo", name: "Sabah and Sarawak", caption: "Malaysian Borneo", bounds: [109.5, 0.85, 119.3, 7.4] },
];

/**
 * The region a camera is looking at: the smallest region that holds the view's centre and still
 * fills a good part of the view (so a national view doesn't read "Klang Valley" because its centre
 * happens to fall there). Zoomed further out than any region, the widest one that holds it.
 */
export function regionForView(view: Pick<Camera, "latitude" | "longitude" | "zoom">): Region {
  const containing = REGIONS.filter(({ bounds: [w, s, e, n] }) => view.longitude >= w && view.longitude <= e && view.latitude >= s && view.latitude <= n);
  const span = (r: Region) => Math.max(r.bounds[2] - r.bounds[0], r.bounds[3] - r.bounds[1]);
  // degrees of longitude a ~1000px-wide view covers at this zoom
  const viewSpan = (1000 / 256) * (360 / 2 ** view.zoom);
  const fitting = containing.filter((r) => span(r) >= viewSpan / 4).sort((a, b) => span(a) - span(b));
  return fitting[0] ?? [...containing].sort((a, b) => span(b) - span(a))[0] ?? REGIONS[0];
}
