import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { seedOfficial } from '../helpers/official-seed.mjs';
import { officialBrowserOptions } from '../helpers/official-auth.mjs';
import { reachablePanelHandleCount, tryOpenRightPanel as probeRightPanel } from '../helpers/panel-interaction.mjs';

async function tryOpenRightPanel(page) {
  const names = [/^Новая задача$/, /^Новый секрет$/, /^Новый навык$/, /Настроить столбц/, /^Столбцы$/, /^Фильтры$/];
  return probeRightPanel(page, names);
}

/**
 * The panel module used to be exercised only against hand-built HTML, so a
 * regression in classify() could not be caught on a real bundle. This test
 * runs against the official running server in whichever mode the gate applied
 * and records panel reachability explicitly, so an unreachable panel is a
 * failure in the enabled mode rather than a silent pass.
 */
test('official panel module: opt-in state, real drag when a panel is reachable', async () => {
  const baseUrl = process.env.PAPERCLIP_TEST_BASE_URL;
  const serverDir = process.env.PAPERCLIP_SERVER_DIR;
  assert.ok(baseUrl && serverDir, 'Official gate requires a running disposable server');
  const enabled = /^(1|true)$/i.test(process.env.PAPERCLIP_RU_PANEL_RESIZE || '');
  const seed = process.env.PAPERCLIP_TEST_SEED ? JSON.parse(fs.readFileSync(process.env.PAPERCLIP_TEST_SEED, 'utf8')) : await seedOfficial(baseUrl);
  const prefix = seed.company.issuePrefix;
  const outputDir = process.env.PAPERCLIP_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-ru-panels-'));

  const manifest = JSON.parse(fs.readFileSync(path.join(serverDir, 'ui-dist/.paperclip-ru/manifest.json'), 'utf8'));
  assert.equal(manifest.features.includes('panel-resize'), enabled, 'manifest features must match the applied mode');

  const routes = [
    `/${prefix}/issues/${seed.issues[0].identifier}`,
    `/${prefix}/issues`,
    `/${prefix}/skills`,
    `/${prefix}/projects/${seed.project.id}`,
    `/${prefix}/agents/${seed.agent.id}/instructions`,
    `/${prefix}/artifacts`,
    `/${prefix}/dashboard`,
  ];

  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const report = { enabled, probes: [], drag: null, panelReachable: false };
  try {
    const page = await browser.newPage({ ...officialBrowserOptions(), viewport: { width: 1600, height: 950 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));

    for (const route of routes) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => Boolean(window.__paperclipRu));
      if (enabled && (await reachablePanelHandleCount(page)) === 0) await tryOpenRightPanel(page);
      const probe = await page.evaluate(() => ({
        panelApi: typeof window.__paperclipRuPanels === 'object' && window.__paperclipRuPanels !== null,
        panels: [...document.querySelectorAll('[data-pc-ru-panel]')].map((p) => p.getAttribute('data-pc-ru-panel')),
        handles: [...document.querySelectorAll('.pc-ru-resize-handle')].filter((h) => !h.hidden && h.getBoundingClientRect().height > 40).length,
        styleTags: document.querySelectorAll('#pc-ru-panels-style').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      report.probes.push({ route, ...probe });

      assert.equal(probe.panelApi, enabled, `${route}: panel API presence must follow the applied mode`);
      if (!enabled) {
        assert.equal(probe.panels.length, 0, `${route}: disabled mode must not mark any panel`);
        assert.equal(probe.handles, 0, `${route}: disabled mode must not inject a handle`);
        assert.equal(probe.styleTags, 0, `${route}: disabled mode must not inject the panel stylesheet`);
      }
      assert.ok(probe.overflow <= 1, `${route}: the module must not cause horizontal overflow (${probe.overflow}px)`);
      assert.ok(probe.styleTags <= 1, `${route}: the panel stylesheet must not be injected twice`);

      if (enabled && probe.handles > 0 && !report.panelReachable) {
        report.panelReachable = true;
        const handle = page.locator('.pc-ru-resize-handle:not([hidden])').first();
        const box = await handle.boundingBox();
        assert.ok(box && box.height > 40, 'The panel handle must have a drag surface');
        await handle.hover({ position: { x: box.width / 2, y: Math.min(box.height / 2, 200) }, timeout: 4000 });
        const target = await page.evaluate(() => {
          const handle = [...document.querySelectorAll('.pc-ru-resize-handle')].find((h) => !h.hidden && h.getBoundingClientRect().height > 40);
          const kind = handle.getAttribute('data-pc-ru-for');
          const panel = document.querySelector(`[data-pc-ru-panel='${kind}']`);
          const hr = handle.getBoundingClientRect();
          return { kind, x: hr.left + hr.width / 2, y: hr.top + Math.min(hr.height / 2, 200), width: Math.round(panel.getBoundingClientRect().width) };
        });
        await page.evaluate(() => {
          window.__qaPanelPointerDown = null;
          document.addEventListener('pointerdown', event => {
            window.__qaPanelPointerDown = { handle: event.target.classList.contains('pc-ru-resize-handle'), kind: event.target.getAttribute('data-pc-ru-for') };
          }, { capture: true, once: true });
        });
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(target.x - (160 * i) / 8, target.y);
        const during = await page.evaluate(() => document.body.classList.contains('pc-ru-resizing'));
        const pointerDown = await page.evaluate(() => window.__qaPanelPointerDown);
        await page.mouse.up();
        await page.waitForTimeout(400);
        const after = await page.evaluate((t) => ({
          width: Math.round(document.querySelector(`[data-pc-ru-panel='${t.kind}']`).getBoundingClientRect().width),
          stored: localStorage.getItem(`paperclip-ru:panel-width:${t.kind}`),
          resizing: document.body.classList.contains('pc-ru-resizing'),
          userSelect: document.body.style.userSelect,
        }), target);
        await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
        if (target.kind === 'sheet' || target.kind === 'drawer') await tryOpenRightPanel(page);
        else {
          // networkidle can precede the fixed panel's React commit. Require
          // its actual, stable hit target before checking the restored width.
          await page.locator(`.pc-ru-resize-handle[data-pc-ru-for='${target.kind}']:not([hidden])`).first().hover({ timeout: 15000 });
        }
        const restored = await page.evaluate((t) => {
          const panel = document.querySelector(`[data-pc-ru-panel='${t.kind}']`);
          return {
            width: panel ? Math.round(panel.getBoundingClientRect().width) : null,
            handles: document.querySelectorAll(`.pc-ru-resize-handle[data-pc-ru-for='${t.kind}']`).length,
            stored: localStorage.getItem(`paperclip-ru:panel-width:${t.kind}`),
          };
        }, target);
        report.drag = { route, kind: target.kind, before: target.width, pointerDown, during, after, restored };

        assert.deepEqual(pointerDown, { handle: true, kind: target.kind }, 'The real pointerdown must reach the selected handle');
        assert.ok(during, 'the body must carry the resizing class during a drag');
        assert.ok(after.width > target.width + 40, `a real drag must widen the panel (${target.width} -> ${after.width})`);
        assert.ok(after.stored != null, 'the chosen width must be persisted');
        assert.equal(after.resizing, false, 'the resizing class must be cleared on pointer up');
        assert.equal(after.userSelect, '', 'user-select must be restored on pointer up');
        assert.equal(restored.stored, after.stored, 'the stored width must survive a reload');
        if (target.kind === 'sheet' || target.kind === 'drawer') {
          assert.ok(restored.width == null || Math.abs(restored.width - after.width) <= 6, `reopened sheet width ${restored.width} vs ${after.width}`);
        } else {
          assert.ok(restored.width != null && Math.abs(restored.width - after.width) <= 6, `the width must survive a reload (${after.width} -> ${restored.width})`);
          assert.equal(restored.handles, 1, 'exactly one handle must exist per panel kind after a reload');
        }
      }
    }
    assert.deepEqual(pageErrors, [], 'the panel module must not raise page errors');
  } finally {
    await browser.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'panels.json'), `${JSON.stringify(report, null, 2)}\n`);
  }

  if (enabled) {
    assert.ok(report.panelReachable && report.drag, 'enabled official gate must open a classified panel and prove a real pointer-drag');
  }
});
