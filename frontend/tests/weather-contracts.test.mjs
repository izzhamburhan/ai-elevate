import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWeatherTime, parseWeatherQuery, weatherBackendUrl, weatherForecastSchema, weatherRowsByExposure,
} from "../src/lib/weather/contracts.ts";

// Deterministic schema fixture only. These values are fabricated, never observed weather.
function fixture() {
  return {
    mode: "replay", research_only: true, generated_at: "2026-10-12T00:00:00Z", warnings: ["Fabricated test fixture"],
    model: { id: "fixture/model", revision: "fixture-revision", framework: "fixture", license: "Apache-2.0" },
    dataset: { source: "fabricated test fixture", last_observation_timestamp: "2026-01-01T00:00:00Z", acquired_at: "2026-10-11T00:00:00Z", license: "test", attribution: "Test data" },
    geojson: { type: "FeatureCollection", features: [{
      type: "Feature", geometry: { type: "Point", coordinates: [101.6869, 3.139] },
      properties: {
        kind: "telecom_site", location_name: "Test site", site_id: "fixture-site", rainfall_mm: 6,
        peak_rainfall_mm: 2, temperature_c: 27, exposure: "elevated", forecast_start: "2026-01-01T01:00:00Z",
        forecast_end: "2026-01-01T06:00:00Z", mode: "replay", synthetic_network_data: true,
        source: "fabricated test fixture", model_id: "fixture/model", units: "mm",
      },
    }] },
  };
}

test("accepts only supported horizons and safe region identifiers", () => {
  for (const horizon of [6, 12, 24]) {
    assert.equal(parseWeatherQuery(new URLSearchParams(`action=forecast&region=kuala_lumpur&horizon_hours=${horizon}`)).horizon_hours, horizon);
  }
  for (const query of ["action=delete", "action=forecast&horizon_hours=48", "action=forecast&horizon_hours=nan", "action=forecast&region=http://attacker.test", "action=forecast&region=../../secret"]) {
    assert.equal(parseWeatherQuery(new URLSearchParams(query)), null);
  }
});

test("query input cannot change the configured upstream origin", () => {
  const query = parseWeatherQuery(new URLSearchParams("action=forecast&region=all&horizon_hours=12&url=http://attacker.test"));
  const url = weatherBackendUrl("http://127.0.0.1:8002", query);
  assert.equal(url.href, "http://127.0.0.1:8002/api/forecast-geojson?region=all&horizon_hours=12");
  assert.throws(() => weatherBackendUrl("file:///private/data", query));
  assert.throws(() => weatherBackendUrl("http://user:secret@localhost", query));
});

test("validates forecast metadata, finite values, units and GeoJSON coordinates", () => {
  assert.equal(weatherForecastSchema.safeParse(fixture()).success, true);
  for (const mutate of [
    (value) => { value.geojson.features[0].geometry.coordinates = [200, 95]; },
    (value) => { value.geojson.features[0].properties.units = "inches"; },
    (value) => { value.geojson.features[0].properties.rainfall_mm = -1; },
    (value) => { value.geojson.features[0].properties.temperature_c = Infinity; },
    (value) => { value.dataset.last_observation_timestamp = "not-a-timestamp"; },
    (value) => { value.research_only = false; },
    (value) => { value.geojson.features[0].properties.forecast_start = "2025-12-31T23:00:00Z"; },
    (value) => { value.geojson.features[0].properties.forecast_end = "2026-01-01T00:00:00Z"; },
    (value) => { value.geojson.features[0].properties.mode = "live"; },
  ]) {
    const value = fixture(); mutate(value);
    assert.equal(weatherForecastSchema.safeParse(value).success, false);
  }
});

test("converts WGS84 points with provenance and stable exposure grouping", () => {
  const forecast = weatherForecastSchema.parse(fixture());
  const rows = weatherRowsByExposure(forecast, "elevated");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].longitude, 101.6869);
  assert.equal(rows[0].latitude, 3.139);
  assert.equal(rows[0].synthetic_network_data, true);
  assert.equal(rows[0].marker_radius, 5);
  assert.equal(weatherRowsByExposure(forecast, "high").length, 0);
});

test("displays UTC timestamps in Malaysia time", () => {
  assert.match(formatWeatherTime("2026-01-01T00:00:00Z"), /08:00/);
});
