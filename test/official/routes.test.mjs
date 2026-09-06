import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { seedOfficial, officialApi } from '../helpers/official-seed.mjs';
import { generateRouteMatrix } from '../../tools/generate-route-matrix.mjs';

test('official operator routes, reloads, responsive layout and composer', async () => {
  const baseUrl = process.env.PAPERCLIP_TEST_BASE_URL;
  const serverDir = process.env.PAPERCLIP_SERVER_DIR;
  assert.ok(baseUrl && serverDir, 'Official gate requires a running disposable server');
  const seed = process.env.PAPERCLIP_TEST_SEED ? JSON.parse(fs.readFileSync(process.env.PAPERCLIP_TEST_SEED, 'utf8')) : await seedOfficial(baseUrl);
  const prefix = seed.company.issuePrefix;
  const companies = await officialApi(baseUrl)('/companies');
  const outputDir = process.env.PAPERCLIP_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-ru-official-'));
  const { matrix } = await generateRouteMatrix({ serverDir, baseUrl, companyPrefix: prefix,
    companyPrefixes: companies.map(c => c.issuePrefix),
    userValues: [seed.company.name, seed.agent.name, seed.project.name, ...seed.issues.map(i => i.title)],
    extraRoutes: [ `/${prefix}/issues?view=board`, `/${prefix}/issues/${seed.issues[0].identifier}`, `/${prefix}/projects/${seed.project.id}`,
      ...['dashboard','instructions','skills','configuration','secrets','tools','runs','audit','budget'].map(tab => `/${prefix}/agents/${seed.agent.id}/${tab}`) ],
    output: path.join(outputDir, 'route-matrix.json'), screenshotsDir: path.join(outputDir, 'screenshots') });
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/${prefix}/issues/${seed.issues[0].identifier}`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('body').innerText()).includes('English user content: Dashboard, Save, Delete.'), 'User markdown must remain English');
    assert.ok((await page.locator('code').allTextContents()).some(text => text.includes('"title":"Dashboard"')), 'JSON sample must remain unchanged');
    await page.getByRole('button', { name: /^Новая задача$/ }).click();
    const composer = page.locator('textarea').filter({ visible: true }).first();
    await composer.waitFor();
    const placeholder = await composer.getAttribute('placeholder');
    assert.match(placeholder, /агенту|задач|Опишите|Напишите/);
    const userText = 'Dashboard Save Delete — user draft  \n{"status":"todo"}\n';
    await composer.fill(userText);
    assert.equal(await composer.inputValue(), userText);
    if (!/^(1|true)$/i.test(process.env.PAPERCLIP_RU_PANEL_RESIZE || '')) {
      assert.equal(await page.locator('.pc-ru-resize-handle,[data-pc-ru-panel]').count(), 0, 'Panel resize must stay opt-in');
    }
  } finally { await browser.close(); }
  const unexpectedErrors = matrix.errors.filter((error) => !(matrix.paperclipVersion === '2026.817.0'
    && error.type === 'console.error'
    && error.message === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
    && /\/api\/companies\/[^/]+\/built-in-agents$/.test(error.location?.url || '')));
  assert.deepEqual(unexpectedErrors, [], 'See route-matrix.json for browser errors');
  assert.deepEqual(matrix.runtimeLeaks, [], 'See route-matrix.json for unclassified English or layout problems');
  assert.ok(Array.isArray(matrix.surfaceProbes) && matrix.surfaceProbes.length > 0, 'menu/select probes must be recorded');
  assert.ok(matrix.surfaceProbes.some((p) => p.surfacesSampled > 0), 'at least one select/menu on official routes must be opened and sampled');
});
