import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRouteMatrix } from "../../tools/generate-route-matrix.mjs";
import { buildCoverageReport } from "../../tools/lib/coverage.mjs";

test("route-matrix generator пишет schema v1", async (t) => {
  const out = path.join(os.tmpdir(), `paperclip-ru-rm-${process.pid}.json`);
  const result = await generateRouteMatrix({ output: out });
  assert.equal(result.matrix.schema, "paperclip-ru-route-matrix/v1");
  assert.ok(result.matrix.provenance);
  assert.ok(Array.isArray(result.matrix.routes));
  assert.ok(result.matrix.routes.length > 0);
  assert.equal(result.matrix.errors.length, 0);
  assert.equal(result.matrix.runtimeLeaks.length, 0);
  assert.ok(Array.isArray(result.matrix.surfaceProbes), "route-matrix must record menu/select probes");
  assert.match(String(result.matrix.provenance.transientSurfaces), /select/i);
  const report = buildCoverageReport({ routeMatrix: out, serverDir: path.resolve("test/fixtures/server") });
  assert.equal(report.routes.length, result.matrix.routes.length);
  assert.ok(report.provenance);
  assert.equal(typeof report.provenance.synthetic, "boolean");
  if (fs.existsSync(out)) fs.rmSync(out, { force: true });
});
