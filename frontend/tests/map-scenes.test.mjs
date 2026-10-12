import assert from "node:assert/strict";
import test from "node:test";
import { REGIONS, captureScene, parseScenes, planSceneRestore, regionForView, sceneCoverage } from "../src/lib/map-scenes.ts";

const source = {
  mapState: { latitude: 3.1, longitude: 101.6, zoom: 9.6, pitch: 30, bearing: -10 },
  mapStyle: { styleType: "elevate-dark" },
  visState: {
    layers: [
      { id: "towers-down-points", config: { dataId: "towers_down", label: "Tower outages", isVisible: true } },
      { id: "abc123", config: { dataId: "weather-ml-high", label: "Weather · High", isVisible: false } },
    ],
    filters: [{ dataId: ["towers_down"], name: ["state"], value: ["Selangor"] }],
  },
};

test("a scene keeps references only: camera, basemap, layer visibility and filters", () => {
  const scene = captureScene(source, "  Klang Valley outages  ", "s1", 1);
  assert.equal(scene.name, "Klang Valley outages");
  assert.deepEqual(scene.camera, { latitude: 3.1, longitude: 101.6, zoom: 9.6, pitch: 30, bearing: -10 });
  assert.deepEqual(scene.layers.map((l) => [l.dataId, l.isVisible]), [["towers_down", true], ["weather-ml-high", false]]);
  assert.deepEqual(scene.filters, [{ dataId: "towers_down", field: "state", value: ["Selangor"] }]);
  assert.equal(JSON.stringify(scene).includes("rows"), false);
});

test("restoring on the same map applies everything", () => {
  const scene = captureScene(source, "A", "s1", 1);
  const map = {
    layers: [{ id: "towers-down-points", dataId: "towers_down", label: "Tower outages" }, { id: "abc123", dataId: "weather-ml-high", label: "Weather · High" }],
    datasets: [{ id: "towers_down", fields: ["tower", "state", "lat", "lng"] }, { id: "weather-ml-high", fields: ["latitude"] }],
    basemaps: ["elevate-dark", "elevate-light"],
  };
  const plan = planSceneRestore(scene, map);
  assert.deepEqual(plan.layers, [{ layerId: "towers-down-points", isVisible: true }, { layerId: "abc123", isVisible: false }]);
  assert.equal(plan.filters.length, 1);
  assert.deepEqual([plan.missingLayers, plan.missingFilters, plan.missingBasemap], [[], [], false]);
  assert.equal(sceneCoverage(scene, map).complete, true);
});

test("a layer recreated under a new id is matched by dataset and label", () => {
  const scene = captureScene(source, "A", "s1", 1);
  const plan = planSceneRestore(scene, {
    layers: [{ id: "new-id", dataId: "weather-ml-high", label: "Weather · High" }],
    datasets: [{ id: "weather-ml-high", fields: [] }],
    basemaps: ["elevate-dark"],
  });
  assert.deepEqual(plan.layers, [{ layerId: "new-id", isVisible: false }]);
});

test("missing datasets, fields and basemaps are reported, never applied", () => {
  const scene = captureScene(source, "A", "s1", 1);
  const map = { layers: [], datasets: [{ id: "towers_down", fields: ["tower"] }], basemaps: ["osm-dark"] };
  const plan = planSceneRestore(scene, map);
  assert.deepEqual(plan.layers, []);
  assert.deepEqual(plan.filters, []);
  assert.deepEqual(plan.missingLayers, ["Tower outages", "Weather · High"]);
  assert.deepEqual(plan.missingFilters, ["state"]);
  assert.equal(plan.missingBasemap, true);
  assert.equal(plan.basemap, undefined);
  assert.deepEqual(sceneCoverage(scene, map), { found: 0, total: 3, complete: false });
});

test("malformed stored scenes are dropped rather than half-restored", () => {
  const good = captureScene(source, "Good", "s1", 1);
  const scenes = parseScenes([good, { id: "x", name: "No camera" }, { ...good, id: "s2", camera: { latitude: 99, longitude: 0, zoom: 3 } }, null, "text"]);
  assert.deepEqual(scenes.map((s) => s.id), ["s1"]);
  assert.deepEqual(parseScenes("not an array"), []);
});

test("the region caption follows the camera", () => {
  assert.equal(regionForView({ latitude: 3.95, longitude: 100.3, zoom: 6.3 }).id, "peninsula");
  assert.equal(regionForView({ latitude: 3.1, longitude: 101.6, zoom: 10 }).id, "klang-valley");
  assert.equal(regionForView({ latitude: 3.1, longitude: 101.6, zoom: 6.3 }).id, "peninsula");
  assert.equal(regionForView({ latitude: 5.4, longitude: 116.5, zoom: 7 }).id, "borneo");
  assert.equal(regionForView({ latitude: 4, longitude: 109, zoom: 4.5 }).id, "malaysia");
  for (const region of REGIONS) {
    const [w, s, e, n] = region.bounds;
    assert.ok(w < e && s < n, region.id);
  }
});
