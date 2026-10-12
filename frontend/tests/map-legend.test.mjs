import assert from "node:assert/strict";
import test from "node:test";
import { legendGroups } from "../src/components/map/command-deck/legend-groups.ts";

// A fake kepler state: column-major rows behind the dataContainer interface the legend reads.
function dataset(rows) {
  const fields = Object.keys(rows[0] ?? {}).map((name) => ({ name }));
  return { fields, dataContainer: { numRows: () => rows.length, valueAt: (r, c) => rows[r][fields[c].name] } };
}
const layer = (id, dataId, label, isVisible = true, color = [255, 77, 109]) => ({ id, config: { dataId, label, isVisible, color } });

test("visible layers are grouped and ordered as the map draws them; hidden ones are left out", () => {
  const groups = legendGroups({
    visState: {
      layerOrder: ["hermes", "down", "high", "mine", "up"],
      layers: [
        layer("up", "towers_up", "Towers up", false),
        layer("high", "weather-ml-high", "Weather · High", true, [239, 68, 68]),
        layer("down", "towers_down", "Tower outages"),
        layer("hermes", "hermes-investigation-findings", "Hermes · source-backed findings", true, [139, 92, 246]),
        layer("mine", "a1b2c3", "Uploaded CSV"),
      ],
      datasets: {
        "weather-ml-high": dataset([{ forecast_start: "2026-10-13T08:00:00+08:00", forecast_end: "2026-10-13T14:00:00+08:00", mode: "replay" }]),
      },
    },
  });
  assert.deepEqual(groups.map((g) => g.id), ["network", "weather", "investigation", "other"]);
  assert.deepEqual(groups[0].entries.map((e) => [e.label, e.ring]), [["Tower outages", true]]);
  assert.equal(groups[1].entries[0].color, "rgb(239 68 68)");
  assert.deepEqual(groups[1].window, { start: "2026-10-13T08:00:00+08:00", end: "2026-10-13T14:00:00+08:00" });
  assert.equal(groups[1].mode, "Historical replay");
});

test("a weather layer without forecast columns gets no invented window", () => {
  const [weather] = legendGroups({
    visState: { layerOrder: ["w"], layers: [layer("w", "weather-ml-low", "Weather · Low")], datasets: { "weather-ml-low": dataset([{ other: 1 }]) } },
  });
  assert.equal(weather.window, undefined);
  assert.equal(weather.mode, undefined);
});

test("an empty map has an empty legend", () => {
  assert.deepEqual(legendGroups({ visState: { layerOrder: [], layers: [layer("x", "towers_down", "Off", false)], datasets: {} } }), []);
});
