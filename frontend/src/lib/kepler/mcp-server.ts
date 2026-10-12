import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { keplerBridgeHub } from "./bridge-hub";
import type { KeplerCommandName } from "./bridge-protocol";

const hexColor = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/)
  .describe('Hex color, e.g. "#ff6600".');

const LAYER_TYPES = [
  "point",
  "arc",
  "line",
  "hexagon",
  "grid",
  "heatmap",
  "cluster",
  "geojson",
  "hexagonId",
  "trip",
  "icon",
  "s2",
  "geohash",
] as const;

const SCALES = ["quantile", "quantize", "linear", "sqrt", "log", "ordinal", "custom"] as const;

const layerStyle = {
  label: z.string().optional().describe("Name shown in the layer panel."),
  color: hexColor.optional().describe("Single color, used when no colorField is set."),
  colorField: z
    .string()
    .nullable()
    .optional()
    .describe("Field that drives color (null removes color-by-field)."),
  colorScale: z.enum(SCALES).optional().describe("Scale for colorField. Default quantile (ordinal for strings)."),
  colorRange: z.array(hexColor).min(2).max(12).optional().describe("Palette for colorField, low → high."),
  sizeField: z.string().nullable().optional().describe("Field that drives point radius (null removes it)."),
  sizeScale: z.enum(["linear", "sqrt", "log"]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: z.number().positive().optional().describe("Point radius (point layers) or bin radius in km (hexagon)."),
  visConfig: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Advanced kepler visConfig overrides, e.g. { thickness: 2, elevationScale: 5, enable3d: true }."),
};

const TOOLS: {
  name: string;
  command: KeplerCommandName;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  readOnly?: boolean;
}[] = [
  {
    name: "kepler_get_map_state",
    command: "get_map_state",
    title: "Get map state",
    description:
      "Describe the kepler.gl map: datasets (id, label, row count, fields with types), layers, filters, " +
      "camera view, basemap and split view. Call it before changing the map, to learn dataset ids, layer ids " +
      "and field names. It only shows data already loaded on the map; to look up new data (e.g. network " +
      "sites or tickets), use the other connectors' search tools.",
    inputSchema: {},
    readOnly: true,
  },
  {
    name: "kepler_get_dataset",
    command: "get_dataset",
    title: "Get dataset rows",
    description: "Fields of a dataset plus a sample of its rows, to see what the values look like.",
    inputSchema: {
      dataId: z.string().describe("Dataset id from kepler_get_map_state."),
      // no min/max: small models overshoot and a validation error wastes the step, so the
      // command clamps to 1..50 instead
      limit: z.number().int().default(5).describe("Rows to return, 1-50; larger values are capped at 50."),
    },
    readOnly: true,
  },
  {
    name: "kepler_load_data",
    command: "load_data",
    title: "Load data onto the map",
    description:
      "Add a dataset to the map. Give exactly one of: url (CSV, GeoJSON or JSON array; relative URLs such as " +
      "/data/world-cities.csv are served by the app), csv (CSV text), geojson (FeatureCollection) or rows " +
      "(array of flat objects, e.g. results from another tool). kepler detects lat/lng columns and " +
      "geometries and adds default layers unless autoCreateLayers is false.",
    inputSchema: {
      label: z.string().describe("Dataset name shown on the map."),
      dataId: z.string().optional().describe("Id to give the dataset. Generated if omitted."),
      url: z.string().optional(),
      csv: z.string().optional(),
      geojson: z.record(z.string(), z.unknown()).optional(),
      rows: z.array(z.record(z.string(), z.unknown())).optional(),
      autoCreateLayers: z.boolean().default(true),
      centerMap: z.boolean().default(true).describe("Zoom the map to the new data."),
    },
  },
  {
    name: "kepler_remove_dataset",
    command: "remove_dataset",
    title: "Remove dataset",
    description: "Remove a dataset and every layer and filter that uses it.",
    inputSchema: { dataId: z.string() },
  },
  {
    name: "kepler_add_layer",
    command: "add_layer",
    title: "Add layer",
    description:
      "Add a visualization layer for a dataset. columns maps the layer's column roles to field names: " +
      "point/heatmap/cluster/hexagon/grid/icon → { lat, lng }; arc/line → { lat0, lng0, lat1, lng1 }; " +
      "geojson → { geojson }; hexagonId (H3) → { hex_id }; s2 → { token }; geohash → { geohash }; " +
      "trip → { geojson }.",
    inputSchema: {
      dataId: z.string(),
      type: z.enum(LAYER_TYPES),
      columns: z.record(z.string(), z.string()).describe("Column role → field name."),
      ...layerStyle,
      isVisible: z.boolean().default(true),
    },
  },
  {
    name: "kepler_update_layer",
    command: "update_layer",
    title: "Update layer",
    description: "Restyle or show/hide an existing layer: color, color-by-field, palette, size, opacity, label.",
    inputSchema: {
      layerId: z.string().describe("Layer id from kepler_get_map_state."),
      isVisible: z.boolean().optional(),
      ...layerStyle,
    },
  },
  {
    name: "kepler_remove_layer",
    command: "remove_layer",
    title: "Remove layer",
    description: "Remove a layer from the map (its dataset stays).",
    inputSchema: { layerId: z.string() },
  },
  {
    name: "kepler_add_filter",
    command: "add_filter",
    title: "Filter data",
    description:
      "Filter a dataset by a field; affects every layer of that dataset. value is [min, max] for numeric or " +
      "time fields (time as epoch milliseconds), a list of values for string fields, or true/false for " +
      "booleans. Omit value to add the filter over the full range. Pass filterId to change an existing filter.",
    inputSchema: {
      dataId: z.string(),
      field: z.string(),
      value: z
        .union([z.array(z.union([z.number(), z.string()])), z.boolean()])
        .optional(),
      filterId: z.string().optional(),
    },
  },
  {
    name: "kepler_remove_filter",
    command: "remove_filter",
    title: "Remove filter",
    description: "Remove a filter by id.",
    inputSchema: { filterId: z.string() },
  },
  {
    name: "kepler_set_view",
    command: "set_view",
    title: "Move the camera",
    description:
      "Move the map camera. Give bounds [minLng, minLat, maxLng, maxLat] to fit an area, or any of " +
      "latitude, longitude, zoom (0–22), pitch (0–60, tilt for 3D) and bearing.",
    inputSchema: {
      bounds: z.array(z.number()).length(4).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      zoom: z.number().min(0).max(22).optional(),
      pitch: z.number().min(0).max(60).optional(),
      bearing: z.number().optional(),
    },
  },
  {
    name: "kepler_set_basemap",
    command: "set_basemap",
    title: "Change basemap",
    description:
      'Change the basemap style. Available without a Mapbox token: "elevate-light" and "elevate-dark" (the ' +
      'app\'s OpenStreetMap basemaps), "positron" (light), "dark-matter" (dark), "voyager" (streets), "no_map" ' +
      '(none). kepler_get_map_state lists every style id.',
    inputSchema: { styleId: z.string() },
  },
  {
    name: "kepler_split_map",
    command: "split_map",
    title: "Split map",
    description:
      "Turn the side-by-side split view on or off. When on, leftLayerIds / rightLayerIds choose which " +
      "layers each side shows (layers not listed are hidden on that side), e.g. to compare two layers.",
    inputSchema: {
      enabled: z.boolean(),
      leftLayerIds: z.array(z.string()).optional(),
      rightLayerIds: z.array(z.string()).optional(),
    },
  },
];

/**
 * MCP server exposing the kepler.gl map. Stateless: one instance per HTTP request; each tool call
 * is forwarded to the browser tab identified by `session` (see bridge-hub.ts).
 */
export function createKeplerMcpServer(session: string | undefined) {
  const server = new McpServer(
    { name: "kepler-gl", version: "1.0.0" },
    {
      instructions:
        "Controls the kepler.gl map open in the Elevate app. Start with kepler_get_map_state to learn " +
        "dataset ids, field names and layer ids, then load data, add/style layers, filter, move the camera, " +
        "change the basemap or split the view.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly ?? false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await keplerBridgeHub.run(session, tool.command, args);
          return { content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: "text", text: message }], isError: true };
        }
      },
    );
  }

  return server;
}
