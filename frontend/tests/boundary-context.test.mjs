import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFeatureMetrics,
  formatBoundaryLabel,
  boundaryAttachment,
  readBoundaryContext,
  BOUNDARY_MEDIA_TYPE,
} from "../src/lib/menara/boundary-context.ts";

test("extracts polygon metrics and calculates centroid, bbox and area", () => {
  const polygonFeature = {
    id: "test-poly-1",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [100.38, 5.37],
          [100.43, 5.37],
          [100.43, 5.42],
          [100.38, 5.42],
          [100.38, 5.37],
        ],
      ],
    },
    properties: {
      shape: "Polygon",
    },
  };

  const metrics = extractFeatureMetrics(polygonFeature);
  assert.equal(metrics.shape, "Polygon");
  assert.equal(metrics.vertexCount, 4);
  assert.ok(metrics.areaKm2 && metrics.areaKm2 > 0);
  assert.ok(metrics.center);
  assert.ok(Math.abs(metrics.center.lat - 5.395) < 0.001);
  assert.ok(Math.abs(metrics.center.lng - 100.405) < 0.001);
  assert.deepEqual(metrics.bbox, [100.38, 5.37, 100.43, 5.42]);

  const label = formatBoundaryLabel(metrics);
  assert.match(label, /Polygon · 4 vertices · ~\d+(\.\d+)? km²/);
});

test("creates and decodes boundary attachment context for LLM", () => {
  const polygonFeature = {
    id: "test-poly-2",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [100.38, 5.37],
          [100.43, 5.40],
          [100.40, 5.42],
          [100.38, 5.37],
        ],
      ],
    },
    properties: {
      shape: "Polygon",
    },
  };

  const attachment = boundaryAttachment(polygonFeature);
  assert.equal(attachment.contentType, BOUNDARY_MEDIA_TYPE);
  assert.equal(attachment.type, "file");
  assert.ok(attachment.content[0].data.startsWith(`data:${BOUNDARY_MEDIA_TYPE};base64,`));

  const decodedContext = readBoundaryContext(attachment.content[0].data);
  assert.match(decodedContext, /Map context: User-drawn boundary on the map/);
  assert.match(decodedContext, /Centroid:/);
  assert.match(decodedContext, /Bounding Box/);
  assert.match(decodedContext, /GeoJSON Geometry:/);
});
