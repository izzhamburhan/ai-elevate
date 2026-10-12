import test from "node:test";
import assert from "node:assert/strict";

import { chipKeys, compactCount, haloRadius, haloRows, zoomFactor } from "../src/lib/subscribers/halos.ts";

// Fabricated fixture, never actual user-mcp or tower-mcp output.
const towers = [
  { enodeb_name: "CYBE-0001", lat: 2.92, lng: 101.65, status: "UP", town: "Cyberjaya" },
  { enodeb_name: "CYBE-0002", lat: 2.93, lng: 101.66, status: "DOWN", town: "Cyberjaya" },
  { enodeb_name: "CYBE-0003", lat: 2.94, lng: 101.67, status: "DEGRADED", town: "Cyberjaya" },
  { enodeb_name: "CYBE-0004", lat: 2.95, lng: 101.68, status: "UP", town: "Cyberjaya" },
];

test("halo rows join status with people, busiest first, and skip towers without people", () => {
  const rows = haloRows(towers, [
    { enodeb_name: "CYBE-0001", subscribers_est: 400 },
    { enodeb_name: "CYBE-0002", subscribers_est: 900 },
    { enodeb_name: "CYBE-0003", subscribers_est: null, subscribers_sampled: 12 },
    { enodeb_name: "CYBE-0004", subscribers_est: 0 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.tower, r.status, r.people]),
    [
      ["CYBE-0002", "DOWN", 900],
      ["CYBE-0001", "UP", 400],
      ["CYBE-0003", "DEGRADED", 12],
    ],
  );
});

test("one size scale for every status: radius grows with the square root of people", () => {
  const big = haloRadius(900, 900, 12);
  const quarter = haloRadius(225, 900, 12);
  const none = haloRadius(0, 900, 12);
  assert.ok(big > quarter && quarter > none);
  assert.ok(Math.abs((quarter - none) / (big - none) - 0.5) < 1e-9);
});

test("halos shrink when zoomed out and stop growing when zoomed in", () => {
  assert.ok(zoomFactor(6) < zoomFactor(12));
  assert.equal(zoomFactor(12), 1);
  assert.equal(zoomFactor(20), zoomFactor(22));
  assert.ok(zoomFactor(3) >= 0.35);
});

test("chips go on the busiest halos, never two close together, and not when zoomed far out", () => {
  const points = [
    { key: "a", x: 100, y: 100, people: 900 },
    { key: "b", x: 110, y: 105, people: 800 }, // too close to a
    { key: "c", x: 300, y: 100, people: 500 },
    { key: "d", x: 500, y: 100, people: 100 },
  ];
  assert.deepEqual([...chipKeys(points, 13)].sort(), ["a", "c", "d"]);
  assert.deepEqual([...chipKeys(points, 13, 2)].sort(), ["a", "c"]);
  assert.equal(chipKeys(points, 8).size, 0);
});

test("counts are short enough for a chip", () => {
  assert.equal(compactCount(980), "980");
  assert.equal(compactCount(1000), "1k");
  assert.equal(compactCount(1240), "1.2k");
  assert.equal(compactCount(12_400), "12k");
});