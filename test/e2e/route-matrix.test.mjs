import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRouteMatrix, waitForRouteContent } from "../../tools/generate-route-matrix.mjs";
import { buildCoverageReport } from "../../tools/lib/coverage.mjs";
import { chromium } from "playwright";

test("route audit waits for asynchronous content and fails on a stuck loading shell", async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Paperclip</title><main>Loading...</main>');
    await page.evaluate(() => {
      window.__paperclipRu = {};
      setTimeout(() => {
        document.title = '\u041e\u0431\u0437\u043e\u0440 - Paperclip';
        document.querySelector('main').innerHTML = '<h1>Ready</h1>';
      }, 250);
    });
    await waitForRouteContent(page);
    assert.equal(await page.locator('h1').innerText(), 'Ready');
    assert.match(await page.title(), /[\u0400-\u04ff]/);

    // Readiness must not hide a missing translation by waiting for Cyrillic.
    await page.evaluate(() => { document.title = 'Untranslated page - Paperclip'; });
    await waitForRouteContent(page, { timeout: 500 });
    assert.doesNotMatch(await page.title(), /[\u0400-\u04ff]/);

    await page.evaluate(() => { document.title = 'Paperclip'; });
    await assert.rejects(waitForRouteContent(page, { timeout: 100 }), /Timeout/);
  } finally {
    await browser.close();
  }
});

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
