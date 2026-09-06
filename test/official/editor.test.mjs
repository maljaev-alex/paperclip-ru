import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { officialApi, seedOfficial } from '../helpers/official-seed.mjs';
import { verifyInstall } from '../../tools/lib/apply.mjs';

test('official editor preserves stored bytes and native save/dirty behavior', async (t) => {
  const baseUrl = process.env.PAPERCLIP_TEST_BASE_URL;
  const serverDir = process.env.PAPERCLIP_SERVER_DIR;
  assert.ok(baseUrl && serverDir, 'Official gate requires an explicit running disposable server and its package directory');
  assert.equal(verifyInstall({ serverDir }).ok, true);
  const api = officialApi(baseUrl);
  const seed = process.env.PAPERCLIP_TEST_SEED ? JSON.parse(fs.readFileSync(process.env.PAPERCLIP_TEST_SEED, 'utf8')) : await seedOfficial(baseUrl);
  const route = `/${seed.company.issuePrefix}/agents/${seed.agent.id}/instructions`;
  const fileRoute = `/agents/${seed.agent.id}/instructions-bundle/file?path=AGENTS.md`;
  const before = await api(fileRoute);
  const paperclipVersion = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).version;
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  t.after(() => browser.close());
  const results = [];
  for (const translated of [false, true]) {
    const context = await browser.newContext();
    if (!translated) await context.route('**/assets/*', async (request) => {
      const rel = new URL(request.request().url()).pathname.slice(1);
      if (rel === 'assets/paperclip-ru-overlay.js') return request.fulfill({ contentType: 'text/javascript', body: '' });
      const original = path.join(serverDir, 'ui-dist', '.paperclip-ru', 'baseline', rel);
      if (fs.existsSync(original)) return request.fulfill({ path: original, contentType: 'text/javascript' });
      return request.continue();
    });
    const page = await context.newPage();
    const errors = [], httpErrors = [], dialogs = [], saves = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', e => {
      if (e.type() === 'error' && !e.text().startsWith('Failed to load resource:')) errors.push(e.text());
    });
    page.on('response', response => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    await page.route('**/instructions-bundle/file**', async (request) => {
      if (request.request().method() !== 'PUT') return request.continue();
      const payload = request.request().postDataJSON();
      saves.push(payload.content);
      return request.fulfill({ json: { ...before, content: payload.content, size: Buffer.byteLength(payload.content) } });
    });
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    const editor = page.locator('[data-lexical-editor="true"]');
    await editor.waitFor();
    const opened = await editor.locator('h1,p,li,.cm-line').allTextContents();
    assert.deepEqual(Buffer.from((await api(fileRoute)).content), Buffer.from(before.content), 'Opening must not write or normalize stored instructions');
    if (translated) {
      assert.equal(await page.getByRole('button', { name: /^Сохранить$/ }).count(), 0, 'Opening must not create a false dirty state');
      await page.locator(`a[href="/${seed.company.issuePrefix}/dashboard"]`).click();
      assert.equal(dialogs.length, 0, 'Opening and leaving must not prompt');
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    }
    await editor.locator('li').first().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' ');
    const save = page.getByRole('button', { name: translated ? /^Сохранить$/ : /^Save$/ });
    await save.waitFor();
    await Promise.all([page.waitForResponse(r => r.url().includes('/instructions-bundle/file') && r.request().method() === 'PUT'), save.click()]);
    assert.equal(saves.length, 1);

    // Upstream 2026.817.0 navigates away without a dirty guard; later stable
    // builds retain the route after the dismissed native confirm. Compatibility
    // means preserving the exact behavior of the same unpatched build, not
    // imposing a newer build's behavior on an older one.
    await editor.locator('li').first().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' ');
    await save.waitFor();
    await page.locator(`a[href="/${seed.company.issuePrefix}/dashboard"]`).click();
    const dirtyNavigation = { dialogs: dialogs.length, pathname: new URL(page.url()).pathname };
    if (paperclipVersion !== '2026.817.0') {
      assert.deepEqual(dirtyNavigation, { dialogs: 1, pathname: route }, 'Current upstream builds must retain their native dirty guard');
    }
    results.push({ opened, savedBytes: [...Buffer.from(saves[0])], dirtyNavigation, errors, httpErrors: [...new Set(httpErrors)].sort() });
    await context.close();
  }
  assert.deepEqual(results[1], results[0], 'Translated editor DOM and exact emitted save bytes must match the unpatched application');
  if (paperclipVersion !== '2026.817.0') assert.deepEqual(results[0].errors, [], results[0].errors.join('\n'));
  assert.deepEqual(Buffer.from((await api(fileRoute)).content), Buffer.from(before.content), 'Network interception must leave stored bytes unchanged');
});
