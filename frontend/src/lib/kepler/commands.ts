"use client";

import {
  ActionTypes,
  addDataToMap,
  addLayer,
  createOrUpdateFilter,
  fitBounds,
  layerConfigChange,
  layerVisConfigChange,
  layerVisualChannelConfigChange,
  mapStyleChange,
  removeDataset,
  removeFilter,
  removeLayer,
  toggleLayerForMap,
  toggleSplitMap,
  updateMap,
  wrapTo,
} from "@kepler.gl/actions";
import { processCsvData, processGeojson, processRowObject } from "@kepler.gl/processors";

import type { makeKeplerStore } from "@/components/map/kepler-store";

import type { KeplerCommandName } from "./bridge-protocol";

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type Layer = Parameters<typeof layerConfigChange>[0];
type KeplerAction = { type: (typeof ActionTypes)[keyof typeof ActionTypes] };
type Args = Record<string, unknown>;

/** The parts of kepler's instance state the commands read. */
type Field = { name: string; type: string };
type Dataset = {
  id: string;
  label: string;
  fields: Field[];
  dataContainer: { numRows(): number; rowAsArray(i: number): unknown[] };
};
type Filter = { id: string; dataId: string[] | string; name: string[] | string; type?: string; value: unknown; domain?: unknown };
type KeplerInstance = {
  visState: {
    datasets: Record<string, Dataset>;
    layers: Layer[];
    layerOrder: string[];
    filters: Filter[];
    splitMaps: { layers: Record<string, boolean> }[];
  };
  mapState: { latitude: number; longitude: number; zoom: number; pitch: number; bearing: number };
  mapStyle: { styleType: string; mapStyles: Record<string, { id: string; label?: string }> };
};

class CommandError extends Error {}

/** Resolves once `ready()` is true; kepler adds datasets asynchronously. */
function waitForState(store: KeplerStore, ready: () => boolean, timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    if (ready()) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new CommandError("kepler did not finish loading the data in time."));
    }, timeoutMs);
    const unsubscribe = store.subscribe(() => {
      if (!ready()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/** Radius-like visConfig key per layer type. */
const RADIUS_KEY: Record<string, string> = {
  point: "radius",
  icon: "radius",
  heatmap: "radius",
  hexagon: "worldUnitSize",
  grid: "worldUnitSize",
  cluster: "clusterRadius",
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function customColorRange(colors: string[]) {
  const normalized = colors.map((c) => (c.startsWith("#") ? c : `#${c}`));
  return { name: "Custom", type: "custom", category: "Custom", colors: normalized };
}

const isDiscrete = (field: Field) => field.type === "string" || field.type === "boolean";

/** Keeps tool results small: long strings and nested objects (geometries) are cut. */
function compact(value: unknown, max = 200): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (value && typeof value === "object") return compact(JSON.stringify(value), max);
  return value;
}

export function runKeplerCommand(
  store: KeplerStore,
  mapId: string,
  name: KeplerCommandName,
  args: Args,
): Promise<unknown> | unknown {
  const read = () => (store.getState().keplerGl as unknown as Record<string, KeplerInstance>)[mapId];
  const dispatch = (action: KeplerAction) => store.dispatch(wrapTo(mapId, action));

  if (!read()) throw new CommandError("The map is still loading. Try again in a moment.");

  const getDataset = (dataId: unknown) => {
    const datasets = read().visState.datasets;
    const dataset = datasets[String(dataId)];
    if (!dataset) {
      throw new CommandError(
        `Unknown dataId "${dataId}". Datasets: ${Object.keys(datasets).join(", ") || "none"}.`,
      );
    }
    return dataset;
  };

  const getField = (dataset: Dataset, fieldName: unknown) => {
    const field = dataset.fields.find((f) => f.name === fieldName);
    if (!field) {
      throw new CommandError(
        `Dataset "${dataset.id}" has no field "${fieldName}". Fields: ${dataset.fields.map((f) => f.name).join(", ")}.`,
      );
    }
    return field;
  };

  const getLayer = (layerId: unknown) => {
    const layers = read().visState.layers;
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) {
      throw new CommandError(`Unknown layerId "${layerId}". Layers: ${layers.map((l) => l.id).join(", ") || "none"}.`);
    }
    return layer;
  };

  const describeLayer = (layer: Layer) => ({
    id: layer.id,
    label: layer.config.label,
    type: layer.type,
    dataId: layer.config.dataId,
    isVisible: layer.config.isVisible,
    columns: Object.fromEntries(
      Object.entries(layer.config.columns ?? {})
        .map(([role, col]) => [role, (col as { value?: unknown } | null)?.value])
        .filter(([, value]) => value != null),
    ),
    colorField: layer.config.colorField?.name ?? null,
    sizeField: layer.config.sizeField?.name ?? null,
  });

  const describeFilter = (filter: Filter) => {
    const domain = Array.isArray(filter.domain) && filter.domain.length > 50
      ? [...filter.domain.slice(0, 50), `… ${filter.domain.length - 50} more`]
      : filter.domain;
    return {
      id: filter.id,
      dataId: Array.isArray(filter.dataId) ? filter.dataId[0] : filter.dataId,
      field: Array.isArray(filter.name) ? filter.name[0] : filter.name,
      type: filter.type,
      value: filter.value,
      domain,
    };
  };

  /** Applies the shared style options of add_layer / update_layer to an existing layer. */
  const applyStyle = (layerId: string, a: Args) => {
    const dataset = getDataset(getLayer(layerId).config.dataId);

    const config: Record<string, unknown> = {};
    if (typeof a.label === "string") config.label = a.label;
    if (typeof a.isVisible === "boolean") config.isVisible = a.isVisible;
    if (typeof a.color === "string") config.color = hexToRgb(a.color);
    if (Object.keys(config).length) dispatch(layerConfigChange(getLayer(layerId), config));

    const visConfig: Record<string, unknown> = { ...((a.visConfig as Args | undefined) ?? {}) };
    if (typeof a.opacity === "number") visConfig.opacity = a.opacity;
    if (typeof a.radius === "number") visConfig[RADIUS_KEY[getLayer(layerId).type ?? ""] ?? "radius"] = a.radius;
    if (Array.isArray(a.colorRange)) visConfig.colorRange = customColorRange(a.colorRange as string[]);
    if (Object.keys(visConfig).length) dispatch(layerVisConfigChange(getLayer(layerId), visConfig));

    if (a.colorField !== undefined || a.colorScale !== undefined) {
      const field = a.colorField ? getField(dataset, a.colorField) : a.colorField === null ? null : getLayer(layerId).config.colorField;
      const colorScale = (a.colorScale as string | undefined) ?? (field && isDiscrete(field) ? "ordinal" : "quantile");
      dispatch(layerVisualChannelConfigChange(getLayer(layerId), { colorField: field, colorScale } as never, "color"));
    }
    if (a.sizeField !== undefined || a.sizeScale !== undefined) {
      const field = a.sizeField ? getField(dataset, a.sizeField) : a.sizeField === null ? null : getLayer(layerId).config.sizeField;
      const sizeScale = (a.sizeScale as string | undefined) ?? "sqrt";
      dispatch(layerVisualChannelConfigChange(getLayer(layerId), { sizeField: field, sizeScale } as never, "size"));
    }
  };

  switch (name) {
    case "get_map_state": {
      const { visState, mapState, mapStyle } = read();
      const byOrder = [...visState.layers].sort(
        (a, b) => visState.layerOrder.indexOf(a.id) - visState.layerOrder.indexOf(b.id),
      );
      return {
        datasets: Object.values(visState.datasets).map((d) => ({
          id: d.id,
          label: d.label,
          rows: d.dataContainer.numRows(),
          fields: d.fields.map(({ name, type }) => ({ name, type })),
        })),
        layers: byOrder.map(describeLayer),
        filters: visState.filters.map(describeFilter),
        view: {
          latitude: mapState.latitude,
          longitude: mapState.longitude,
          zoom: mapState.zoom,
          pitch: mapState.pitch,
          bearing: mapState.bearing,
        },
        basemap: mapStyle.styleType,
        basemaps: Object.keys(mapStyle.mapStyles),
        splitMap: visState.splitMaps.length
          ? visState.splitMaps.map((m) => Object.keys(m.layers).filter((id) => m.layers[id]))
          : null,
      };
    }

    case "get_dataset": {
      const dataset = getDataset(args.dataId);
      const total = dataset.dataContainer.numRows();
      const limit = Math.min(Number(args.limit ?? 5), total);
      const rows = Array.from({ length: limit }, (_, i) => {
        const values = dataset.dataContainer.rowAsArray(i);
        return Object.fromEntries(dataset.fields.map((f, j) => [f.name, compact(values[j])]));
      });
      return { id: dataset.id, label: dataset.label, rows: total, fields: dataset.fields.map(({ name, type }) => ({ name, type })), sample: rows };
    }

    case "load_data":
      return loadData(args);

    case "remove_dataset": {
      const dataset = getDataset(args.dataId);
      dispatch(removeDataset(dataset.id));
      return { removed: dataset.id };
    }

    case "add_layer": {
      const dataset = getDataset(args.dataId);
      const columns = (args.columns as Record<string, string>) ?? {};
      for (const fieldName of Object.values(columns)) getField(dataset, fieldName);

      const type = String(args.type);
      const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
      const before = read().visState.layers.length;
      dispatch(
        addLayer({
          id,
          type,
          config: {
            dataId: dataset.id,
            label: (args.label as string | undefined) ?? `${dataset.label} ${type}`,
            columns,
            isVisible: args.isVisible ?? true,
            ...(typeof args.color === "string" ? { color: hexToRgb(args.color) } : {}),
          },
          // marks the config as a saved (v1) layer so kepler parses it
          visualChannels: {},
        }),
      );
      if (read().visState.layers.length === before) {
        throw new CommandError(
          `kepler could not create a ${type} layer with columns ${JSON.stringify(columns)}. ` +
            `Check the column roles for this layer type. Fields: ${dataset.fields.map((f) => `${f.name} (${f.type})`).join(", ")}.`,
        );
      }
      applyStyle(id, { ...args, label: undefined, isVisible: undefined, color: undefined });
      return { layer: describeLayer(getLayer(id)) };
    }

    case "update_layer": {
      const layerId = getLayer(args.layerId).id;
      applyStyle(layerId, args);
      return { layer: describeLayer(getLayer(layerId)) };
    }

    case "remove_layer": {
      const layer = getLayer(args.layerId);
      dispatch(removeLayer(layer.id));
      return { removed: layer.id };
    }

    case "add_filter": {
      const dataset = getDataset(args.dataId);
      const field = getField(dataset, args.field);
      const filterId = args.filterId as string | undefined;
      const before = read().visState.filters;
      // an unknown filterId creates a new filter with that id
      dispatch(createOrUpdateFilter(filterId, dataset.id, field.name, args.value));
      const filters = read().visState.filters;
      const filter = filterId ? filters.find((f) => f.id === filterId) : filters.length > before.length ? filters[filters.length - 1] : undefined;
      if (!filter) throw new CommandError(`kepler could not filter "${dataset.id}" by "${field.name}".`);
      return { filter: describeFilter(filter) };
    }

    case "remove_filter": {
      const idx = read().visState.filters.findIndex((f) => f.id === args.filterId);
      if (idx < 0) throw new CommandError(`Unknown filterId "${args.filterId}".`);
      dispatch(removeFilter(idx));
      return { removed: args.filterId };
    }

    case "set_view": {
      if (Array.isArray(args.bounds)) {
        dispatch(fitBounds(args.bounds as [number, number, number, number]));
      } else {
        const viewport = Object.fromEntries(
          ["latitude", "longitude", "zoom", "pitch", "bearing"]
            .filter((key) => typeof args[key] === "number")
            .map((key) => [key, args[key]]),
        );
        if (!Object.keys(viewport).length) throw new CommandError("Give bounds or at least one of latitude, longitude, zoom, pitch, bearing.");
        dispatch(updateMap(viewport));
      }
      const { latitude, longitude, zoom, pitch, bearing } = read().mapState;
      return { view: { latitude, longitude, zoom, pitch, bearing } };
    }

    case "set_basemap": {
      const styles = read().mapStyle.mapStyles;
      const styleId = String(args.styleId);
      if (!styles[styleId]) {
        throw new CommandError(`Unknown basemap "${styleId}". Available: ${Object.keys(styles).join(", ")}.`);
      }
      dispatch(mapStyleChange(styleId));
      return { basemap: styleId };
    }

    case "split_map": {
      const isSplit = read().visState.splitMaps.length > 0;
      if (args.enabled !== isSplit) dispatch(toggleSplitMap(args.enabled ? 0 : 1));
      if (args.enabled) {
        const sides = [args.leftLayerIds, args.rightLayerIds] as (string[] | undefined)[];
        sides.forEach((ids, mapIndex) => {
          if (!ids) return;
          ids.forEach(getLayer);
          for (const layer of read().visState.layers) {
            const shown = Boolean(read().visState.splitMaps[mapIndex]?.layers[layer.id]);
            if (shown !== ids.includes(layer.id)) dispatch(toggleLayerForMap(mapIndex, layer.id));
          }
        });
      }
      const { splitMaps } = read().visState;
      return {
        splitMap: splitMaps.length ? splitMaps.map((m) => Object.keys(m.layers).filter((id) => m.layers[id])) : null,
      };
    }
  }

  async function loadData(a: Args) {
    const sources = ["url", "csv", "geojson", "rows"].filter((key) => a[key] !== undefined);
    if (sources.length !== 1) throw new CommandError("Give exactly one of url, csv, geojson or rows.");

    let data;
    if (a.rows) data = processRowObject(a.rows as unknown[]);
    else if (a.geojson) data = processGeojson(a.geojson);
    else if (a.csv) data = processCsvData(String(a.csv));
    else {
      const res = await fetch(String(a.url));
      if (!res.ok) throw new CommandError(`Could not download ${a.url} (HTTP ${res.status}).`);
      const text = await res.text();
      const start = text.trimStart()[0];
      if (start === "{" || start === "[") {
        const json = JSON.parse(text);
        if (Array.isArray(json)) data = processRowObject(json);
        else if (json?.type === "FeatureCollection" || json?.type === "Feature") data = processGeojson(json);
        else throw new CommandError("JSON data must be an array of rows or a GeoJSON FeatureCollection.");
      } else {
        data = processCsvData(text);
      }
    }
    if (!data) throw new CommandError("kepler could not parse the data.");

    const label = String(a.label);
    const dataId =
      (a.dataId as string | undefined) ??
      `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data"}-${Math.random().toString(36).slice(2, 6)}`;

    // a reload of the same dataId replaces the dataset object, so wait for a new one
    const previous = read().visState.datasets[dataId];
    dispatch(
      addDataToMap({
        datasets: { info: { id: dataId, label }, data },
        options: {
          centerMap: a.centerMap !== false,
          autoCreateLayers: a.autoCreateLayers !== false,
          keepExistingConfig: true,
        },
      }),
    );

    await waitForState(store, () => {
      const current = read().visState.datasets[dataId];
      return Boolean(current) && current !== previous;
    });
    const dataset = getDataset(dataId);
    return {
      dataset: {
        id: dataset.id,
        label: dataset.label,
        rows: dataset.dataContainer.numRows(),
        fields: dataset.fields.map(({ name, type }) => ({ name, type })),
      },
      layers: read().visState.layers.filter((l) => l.config.dataId === dataId).map(describeLayer),
    };
  }
}
