import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRouteMatrix, waitForRouteContent, readRouteAuditState } from "../../tools/generate-route-matrix.mjs";
import { buildCoverageReport } from "../../tools/lib/coverage.mjs";
import { chromium } from "playwright";
import { classifyEnglish } from '../helpers/route-allowlist.mjs';

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

test('route audit identifies only the actual ActivityRow actor leaf and composite title', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.goto('http://127.0.0.1/CMP/dashboard');
    await page.evaluate(() => {
      window.__paperclipRu = { diagnostics: { hookFailures: [] } };
      const read = '\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b';
      const row = (name, action, className = 'dashboard-list-row') => {
        const wrapper = document.createElement('div');
        wrapper.className = className;
        const summary = document.createElement('span');
        summary.className = 'max-w-1/2 shrink-0 truncate';
        summary.title = `${name} ${action}`;
        const actor = document.createElement('span');
        actor.textContent = name;
        const verb = document.createElement('span');
        verb.className = 'text-muted-foreground';
        verb.textContent = action;
        summary.append(actor, ' ', verb);
        wrapper.append(summary);
        document.querySelector('main').append(wrapper);
      };
      row('Board', read);
      row('Save', read);
      row('Board', 'read');
      row('Board', `${read} failed`);
      row('Unseeded', read);
      row('Board', read, 'unrelated-row');
      const unrelated = document.createElement('span');
      unrelated.textContent = 'Board';
      document.querySelector('main').append(unrelated);
    });
    const state = await page.evaluate(readRouteAuditState);
    const options = { activityActors: [{ id: 'local-board', label: 'Board' }, { id: 'custom', label: 'Save' }] };
    const classified = state.candidates.map(candidate => ({ ...candidate,
      reason: classifyEnglish({ ...candidate, route: '/CMP/dashboard' }, options) }));
    assert.equal(classified.filter(c => c.context === 'activity-actor-name').length, 5);
    assert.equal(classified.filter(c => c.reason === 'api-activity-actor-name').length, 4);
    assert.equal(classified.filter(c => c.reason === 'api-activity-actor-with-translated-action').length, 2);
    for (const value of ['Board read', 'Board \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b failed', 'Unseeded \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b']) {
      assert.equal(classified.find(c => c.attribute === 'title' && c.value === value).reason, null);
    }
    assert.ok(classified.filter(c => c.value === 'Board' && !c.context).length >= 2);
    assert.ok(classified.filter(c => c.value === 'Board' && !c.context).every(c => c.reason === null));
    await page.evaluate(() => history.replaceState(null, '', '/CMP/issues'));
    assert.ok((await page.evaluate(readRouteAuditState)).candidates.every(c => !c.context?.startsWith('activity-actor-')));
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
