import { INITIAL_MAP_STYLE } from "@kepler.gl/reducers";

/**
 * The workspace basemaps: OpenStreetMap's standard raster tiles, styled like the Menara command
 * center's map (menara-command-tower). Its dark map is the light one inverted, hue-rotated 195°,
 * dimmed and desaturated (a CSS filter there). Here the same treatment is done with MapLibre's
 * raster paint, so it touches only the tiles and never the data layers drawn on top. Swapping
 * brightness-min and -max inverts the tiles; hue-rotate commutes with inversion.
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

export const BASEMAP_DARK = "elevate-dark";
export const BASEMAP_LIGHT = "elevate-light";

const defaults = INITIAL_MAP_STYLE.mapStyles as Record<string, { icon?: string }>;

/** kepler `mapStyles` entries; the style objects are inline, so kepler never fetches them. */
export const ELEVATE_BASEMAPS = {
  [BASEMAP_DARK]: {
    id: BASEMAP_DARK,
    label: "Elevate dark",
    icon: defaults["dark-matter"]?.icon,
    style: osmStyle("Elevate dark", "#14111d", {
      "raster-brightness-min": 0.82,
      "raster-brightness-max": 0,
      "raster-hue-rotate": 195,
      "raster-saturation": -0.45,
      "raster-contrast": -0.08,
    }),
  },
  [BASEMAP_LIGHT]: {
    id: BASEMAP_LIGHT,
    label: "Elevate light",
    icon: defaults.positron?.icon,
    style: osmStyle("Elevate light", "#f6f5f8", {
      "raster-saturation": -0.55,
      "raster-contrast": -0.1,
      "raster-brightness-min": 0.08,
    }),
  },
};

/** kepler's own basemaps plus ours, for the `mapStyle.mapStyles` initial state. */
export const MAP_STYLES = { ...INITIAL_MAP_STYLE.mapStyles, ...ELEVATE_BASEMAPS };
