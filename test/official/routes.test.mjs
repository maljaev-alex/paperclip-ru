import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { seedOfficial, officialApi, officialAssistantClientName } from '../helpers/official-seed.mjs';
import { generateRouteMatrix } from '../../tools/generate-route-matrix.mjs';
import { officialRoutePlan, assertOfficialRouteDestinations } from '../helpers/official-routes.mjs';
import { officialAuthenticated, officialBrowserOptions, useOriginalOfficialAssets } from '../helpers/official-auth.mjs';

test('official operator routes, reloads, responsive layout and composer', async () => {
  const baseUrl = process.env.PAPERCLIP_TEST_BASE_URL;
  const serverDir = process.env.PAPERCLIP_SERVER_DIR;
  assert.ok(baseUrl && serverDir, 'Official gate requires a running disposable server');
  const seed = process.env.PAPERCLIP_TEST_SEED ? JSON.parse(fs.readFileSync(process.env.PAPERCLIP_TEST_SEED, 'utf8')) : await seedOfficial(baseUrl);
  const prefix = seed.company.issuePrefix;
  const companies = await officialApi(baseUrl)('/companies');
  const outputDir = process.env.PAPERCLIP_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-ru-official-'));
  const expectedDescription = 'English user content: Dashboard, Save, Delete.\n\n```json\n{"status":"todo","title":"Dashboard"}\n```';
  const storedIssue = await officialApi(baseUrl)(`/issues/${seed.issues[0].id}`);
  assert.equal(storedIssue.description, expectedDescription, 'Stored user markdown must remain byte-for-byte unchanged');
  const version = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).version;
  const settings = await officialApi(baseUrl)('/instance/settings/experimental');
  const plan = officialRoutePlan({ version, seed, settings, authenticated: officialAuthenticated() });
  const { matrix } = await generateRouteMatrix({ serverDir, baseUrl, companyPrefix: prefix,
    companyPrefixes: companies.map(c => c.issuePrefix),
    userValues: [seed.company.name, seed.agent.name, seed.project.name, seed.conversation?.title, seed.owner?.name, seed.owner?.email, ...seed.issues.map(i => i.title)].filter(Boolean),
    activityActors: seed.activityActors,
    assistantClientNames: officialAuthenticated() ? [officialAssistantClientName] : [],
    extraRoutes: plan.extraRoutes,
    onRoute: route => process.stderr.write(`Official route: ${route}\n`),
    output: path.join(outputDir, 'route-matrix.json'), screenshotsDir: path.join(outputDir, 'screenshots') });
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage(officialBrowserOptions());
    await page.goto(`${baseUrl}/${prefix}/issues/${seed.issues[0].identifier}`, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(
        (text) => document.body.innerText.includes(text),
        'English user content: Dashboard, Save, Delete.',
        { timeout: 15000 },
      );
      await page.locator('code').filter({ hasText: '"title":"Dashboard"' }).first().waitFor({ timeout: 15000 });
    } catch (error) {
      fs.writeFileSync(path.join(outputDir, 'issue-detail-body.txt'), await page.locator('body').innerText());
      throw error;
    }
    const userText = 'Dashboard Save Delete — user draft  \n{"status":"todo"}\n';
    const draft = async (target, translated) => {
      await target.getByRole('button', { name: translated ? /^Новая задача$/ : /^New (?:task|issue)$/i }).click();
      // October's New task dialog uses the native rich MarkdownEditor. Older
      // releases and its fallback still use a textarea.
      const composer = target.locator('[role="dialog"] textarea, [role="dialog"] [contenteditable="true"]').filter({ visible: true }).first();
      await composer.waitFor();
      const placeholder = await composer.getAttribute('placeholder')
        || await target.locator('[role="dialog"] [data-testid="task-chat-composer-input"]').innerText();
      if (translated) assert.match(placeholder, /агенту|задач|Опишите|Напишите/);
      await composer.fill(userText);
      await target.waitForTimeout(200);
      const value = await composer.evaluate(el => el instanceof HTMLTextAreaElement ? el.value : el.innerText);
      assert.ok(value.includes('Dashboard Save Delete'), 'Dictionary keys in the draft must remain user content');
      assert.ok(value.includes('{"status":"todo"}'), 'Structured draft content must remain unchanged');
      return { tag: await composer.evaluate(el => el.tagName), value };
    };
    const translatedDraft = await draft(page, true);
    const original = await browser.newContext(officialBrowserOptions());
    try {
      await useOriginalOfficialAssets(original, serverDir);
      const originalPage = await original.newPage();
      await originalPage.goto(`${baseUrl}/${prefix}/issues/${seed.issues[0].identifier}`, { waitUntil: 'networkidle' });
      assert.deepEqual(translatedDraft, await draft(originalPage, false), 'The translated composer must preserve the exact draft behavior of this upstream build');
    } finally { await original.close(); }
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
  assertOfficialRouteDestinations(matrix, plan);
  assert.ok(Array.isArray(matrix.surfaceProbes) && matrix.surfaceProbes.length > 0, 'menu/select probes must be recorded');
  assert.ok(matrix.surfaceProbes.some((p) => p.surfacesSampled > 0), 'at least one select/menu on official routes must be opened and sampled');
});
