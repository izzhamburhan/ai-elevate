import { DEFAULT_LAYER_GROUPS, THREE_D_BUILDING_LAYER_GROUP_SLUG } from "@kepler.gl/constants";
import { INITIAL_MAP_STYLE } from "@kepler.gl/reducers";
import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import { PMTiles, Protocol } from "pmtiles";

/**
 * The workspace basemaps, styled like the Menara command center's map (menara-command-tower):
 * warm near-black land, blue-grey sea and dark green woods in the dark theme, a quiet desaturated
 * map in the light one.
 *
 * They are Protomaps' vector styles over self-hosted OpenStreetMap tiles (`npm run basemap` puts
 * malaysia.pmtiles, fonts and sprites in public/basemap), so roads and labels stay sharp at any
 * zoom and pixel density. Until those files exist, the same ids fall back to OpenStreetMap's
 * standard raster tiles, given the Menara look with MapLibre raster paint. The vector colors are
 * sampled from that fallback, so both read as the same map.
 */

export const BASEMAP_DARK = "elevate-dark";
export const BASEMAP_LIGHT = "elevate-light";
/** OpenStreetMap's raster tiles with the same theme treatment, offered beside the vector basemaps. */
export const BASEMAP_OSM_DARK = "osm-dark";
export const BASEMAP_OSM_LIGHT = "osm-light";

/** Folder with malaysia.pmtiles, fonts/ and sprites/. Set NEXT_PUBLIC_BASEMAP_URL to serve it elsewhere. */
const BASEMAP_URL = process.env.NEXT_PUBLIC_BASEMAP_URL || "/basemap/";
/** A slow tile host must not hold up the map: past this, it opens on the raster fallback. */
const PROBE_TIMEOUT_MS = 5000;
/** Places keep their local name; ones in another script (Thai, Chinese) get a Latin name above it. */
const LABEL_LANG = "ms";

const SEA_DARK = "#25313c";
const SEA_LIGHT = "#bbcacf";

const DARK_FLAVOR: Flavor = {
  ...namedFlavor("dark"),
  // the sea is also what shows past the edge of the Malaysia extract
  background: SEA_DARK,
  water: SEA_DARK,
  earth: "#161613",
  park_a: "#1a3122",
  park_b: "#1a3122",
  wood_a: "#3b4d3a",
  wood_b: "#3b4d3a",
  scrub_a: "#353f2d",
  scrub_b: "#353f2d",
  zoo: "#1a3122",
  sand: "#242513",
  beach: "#242513",
  industrial: "#20191d",
  buildings: "#2e2c28",
  highway: "#573834",
  bridges_highway: "#573834",
  boundaries: "#5d5a68",
  ocean_label: "#576280",
  city_label: "#c9c9c9",
  city_label_halo: "#121210",
  subplace_label: "#7d7b86",
  subplace_label_halo: "#121210",
  state_label: "#6a6775",
  state_label_halo: "#121210",
  country_label: "#8a8796",
  roads_label_minor: "#6c6b72",
  roads_label_minor_halo: "#161613",
  roads_label_major: "#85838c",
  roads_label_major_halo: "#161613",
  landcover: {
    forest: "rgba(59, 77, 58, 1)",
    grassland: "rgba(42, 60, 36, 1)",
    scrub: "rgba(53, 63, 45, 1)",
    farmland: "rgba(28, 32, 20, 1)",
    barren: "rgba(36, 37, 19, 1)",
    urban_area: "rgba(33, 32, 32, 1)",
    glacier: "rgba(43, 43, 43, 1)",
  },
};

const LIGHT_CASING = "#cfccc8";

const LIGHT_FLAVOR: Flavor = {
  ...namedFlavor("light"),
  background: SEA_LIGHT,
  water: SEA_LIGHT,
  earth: "#e7e6e3",
  park_a: "#cee1cf",
  park_b: "#cee1cf",
  wood_a: "#b3c0ad",
  wood_b: "#b3c0ad",
  scrub_a: "#c4c9b9",
  scrub_b: "#c4c9b9",
  zoo: "#cee1cf",
  sand: "#e2ded1",
  beach: "#e2ded1",
  industrial: "#e0dadf",
  hospital: "#ebe2e1",
  school: "#ebe6df",
  buildings: "#d0cdca",
  minor_service_casing: LIGHT_CASING,
  minor_casing: LIGHT_CASING,
  link_casing: LIGHT_CASING,
  major_casing_early: LIGHT_CASING,
  major_casing_late: LIGHT_CASING,
  highway_casing_early: LIGHT_CASING,
  highway_casing_late: LIGHT_CASING,
  boundaries: "#a5a4a9",
  ocean_label: "#778a9d",
  city_label: "#3d3a4a",
  city_label_halo: "#f3f3f3",
  state_label: "#a9a6b4",
  country_label: "#8f8c9c",
  landcover: {
    forest: "rgba(179, 192, 173, 1)",
    grassland: "rgba(202, 213, 191, 1)",
    scrub: "rgba(196, 201, 185, 1)",
    farmland: "rgba(226, 226, 216, 1)",
    barren: "rgba(226, 222, 209, 1)",
    urban_area: "rgba(217, 217, 217, 1)",
    glacier: "rgba(255, 255, 255, 1)",
  },
};

const VECTOR_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

type StyleLayer = { id: string; type?: string };

/**
 * kepler's base map toggles (labels, roads, borders…) for the Protomaps layer ids. kepler's own
 * groups hide borders by default, which would drop the state and country lines, and miss the
 * land-use layers. Its 3D buildings draw Mapbox's tiles, which need a token, so that one is left out.
 */
const VECTOR_LAYER_GROUPS = DEFAULT_LAYER_GROUPS
  .filter((group) => group.slug !== THREE_D_BUILDING_LAYER_GROUP_SLUG)
  .map((group) =>
    group.slug === "border"
      ? { ...group, defaultVisibility: true }
      : group.slug === "land"
        ? { ...group, filter: ({ id }: StyleLayer) => /^(landcover|landuse)/.test(id) }
        : group,
  );

/** The tiles and assets in use, once `loadBasemaps` has found them. */
let vectorTiles: { archive: string; assets: string } | undefined;
let loading: Promise<void> | undefined;

/**
 * Checks the self-hosted tiles are there and registers MapLibre's `pmtiles://` protocol for them.
 * Run it before the map's store is made, so `mapStyles()` knows which basemaps it can offer.
 */
export function loadBasemaps() {
  loading ??= (async () => {
    try {
      const assets = new URL(BASEMAP_URL.replace(/\/?$/, "/"), window.location.href).href;
      const archive = new PMTiles(new URL("malaysia.pmtiles", assets).href);
      // throws unless the file is there and is a PMTiles archive
      await Promise.race([
        archive.getHeader(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), PROBE_TIMEOUT_MS)),
      ]);
      const protocol = new Protocol();
      protocol.add(archive);
      // kepler loads this same module for its maps, so they see the protocol
      const { addProtocol } = await import("maplibre-gl");
      addProtocol("pmtiles", protocol.tile);
      vectorTiles = { archive: archive.source.getKey(), assets };
    } catch (error) {
      console.warn(
        "[basemap] Self-hosted vector tiles unavailable, using OpenStreetMap's raster tiles. Run `npm run basemap`.",
        error,
      );
    }
  })();
  return loading;
}

/** Whether the self-hosted vector tiles loaded; without them the Elevate basemaps are raster too. */
export const hasVectorTiles = () => Boolean(vectorTiles);

type VectorTiles = NonNullable<typeof vectorTiles>;

function vectorStyle(name: string, flavor: Flavor, sprite: "light" | "dark", tiles: VectorTiles) {
  return {
    version: 8,
    name,
    glyphs: `${tiles.assets}fonts/{fontstack}/{range}.pbf`,
    sprite: `${tiles.assets}sprites/${sprite}`,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${tiles.archive}`, attribution: VECTOR_ATTRIBUTION },
    },
    layers: layers("protomaps", flavor, { lang: LABEL_LANG }),
  };
}

/**
 * The fallback: OpenStreetMap's standard raster tiles. Its dark map is the light one inverted,
 * hue-rotated 195°, dimmed and desaturated (a CSS filter in the Menara reference). Here that is
 * MapLibre raster paint, so it touches only the tiles and never the data layers drawn on top.
 * Swapping brightness-min and -max inverts the tiles; hue-rotate commutes with inversion.
 */
const OSM_SOURCE = {
  type: "raster",
  tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
  tileSize: 256,
  maxzoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

function osmStyle(name: string, background: string, paint: Record<string, number>) {
  return {
    version: 8,
    name,
    sources: { osm: OSM_SOURCE },
    layers: [
      { id: "background", type: "background", paint: { "background-color": background } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-fade-duration": 150, ...paint } },
    ],
  };
}

/** The Menara dark look, from the light tiles. */
const OSM_DARK_PAINT = {
  "raster-brightness-min": 0.82,
  "raster-brightness-max": 0,
  "raster-hue-rotate": 195,
  "raster-saturation": -0.45,
  "raster-contrast": -0.08,
};
const OSM_LIGHT_PAINT = { "raster-saturation": -0.55, "raster-contrast": -0.1, "raster-brightness-min": 0.08 };

const defaults = INITIAL_MAP_STYLE.mapStyles as Record<string, { icon?: string }>;

/** kepler `mapStyles` entries; the style objects are inline, so kepler never fetches them. */
function elevateBasemaps() {
  const tiles = vectorTiles;
  const layerGroups = tiles ? { layerGroups: VECTOR_LAYER_GROUPS } : {};
  return {
    [BASEMAP_DARK]: {
      id: BASEMAP_DARK,
      label: "Elevate dark",
      icon: defaults["dark-matter"]?.icon,
      ...layerGroups,
      style: tiles
        ? vectorStyle("Elevate dark", DARK_FLAVOR, "dark", tiles)
        : osmStyle("Elevate dark", "#14111d", OSM_DARK_PAINT),
    },
    [BASEMAP_LIGHT]: {
      id: BASEMAP_LIGHT,
      label: "Elevate light",
      icon: defaults.positron?.icon,
      ...layerGroups,
      style: tiles
        ? vectorStyle("Elevate light", LIGHT_FLAVOR, "light", tiles)
        : osmStyle("Elevate light", "#f6f5f8", OSM_LIGHT_PAINT),
    },
    [BASEMAP_OSM_DARK]: {
      id: BASEMAP_OSM_DARK,
      label: "OpenStreetMap dark",
      icon: defaults["dark-matter"]?.icon,
      style: osmStyle("OpenStreetMap dark", "#14111d", OSM_DARK_PAINT),
    },
    [BASEMAP_OSM_LIGHT]: {
      id: BASEMAP_OSM_LIGHT,
      label: "OpenStreetMap light",
      icon: defaults.positron?.icon,
      style: osmStyle("OpenStreetMap light", "#f6f5f8", OSM_LIGHT_PAINT),
    },
  };
}

/** kepler's own basemaps plus ours, for the `mapStyle.mapStyles` initial state. */
export function mapStyles() {
  return { ...INITIAL_MAP_STYLE.mapStyles, ...elevateBasemaps() };
}
