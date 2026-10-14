import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { officialApi, officialAssistantClientName } from '../helpers/official-seed.mjs';
import { officialAuthenticated, officialBrowserOptions, officialCookieHeader, useOriginalOfficialAssets } from '../helpers/official-auth.mjs';
import { supportsPublicMcp } from '../helpers/official-routes.mjs';
import { classifyEnglish } from '../helpers/route-allowlist.mjs';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const safePath = url => new URL(url).pathname.replace(/(\/mcp\/(?:requests|connections)\/)[^/]+/, '$1<qa-id>');

test('official assistant setup and consent preserve upstream behavior and user content', async t => {
  const baseUrl = process.env.PAPERCLIP_TEST_BASE_URL;
  const serverDir = process.env.PAPERCLIP_SERVER_DIR;
  const output = process.env.PAPERCLIP_TEST_OUTPUT;
  assert.ok(baseUrl && serverDir && output && process.env.PAPERCLIP_TEST_SEED, 'The disposable official gate is required');
  const version = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).version;
  if (!supportsPublicMcp(version)) return t.skip('Assistant Connection is not shipped in this official release');
  const seed = JSON.parse(fs.readFileSync(process.env.PAPERCLIP_TEST_SEED, 'utf8'));
  const api = officialApi(baseUrl);
  const authenticated = officialAuthenticated();
  const report = { version, authenticated, prerequisites: [], scenarios: [], runtimeLeaks: [] };
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const ownedGrants = new Set();
  let restoreCompanyName;
  const userValues = [officialAssistantClientName, seed.company.name, seed.owner?.name, seed.owner?.email].filter(Boolean);
  const request = async (route, { method = 'GET', body, session = false, redirect = 'follow' } = {}) => fetch(`${baseUrl}${route}`, {
    method, redirect, headers: { 'content-type': 'application/json', origin: baseUrl, ...(session ? officialCookieHeader(baseUrl) : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const requestJson = async (route, options) => {
    const response = await request(route, options);
    assert.ok(response.ok, `QA MCP request failed: ${response.status} ${route}`);
    return response.json();
  };
  const audit = async (page, stage, { deviceCode } = {}) => {
    const state = await page.evaluate(() => {
      const visible = el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
      const candidates = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) {
        const el = node.parentElement;
        if (!visible(el) || el.closest('textarea,input,pre,code,script,style,[contenteditable="true"],.prose,.cm-content')) continue;
        const value = node.nodeValue.trim();
        if (/[A-Za-z]{2}/.test(value)) candidates.push({ value, tag: el.tagName, className: el.className });
      }
      for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
        if (!visible(el) || el.closest('pre,code,[contenteditable="true"],.prose,.cm-content')) continue;
        for (const attribute of ['placeholder', 'aria-label', 'title']) {
          const value = el.getAttribute(attribute)?.trim();
          if (value && /[A-Za-z]{2}/.test(value)) candidates.push({ value, tag: el.tagName, className: el.className, attribute });
        }
      }
      return { candidates, overflow: document.documentElement.scrollWidth - innerWidth,
        failures: window.__paperclipRu?.diagnostics.hookFailures, lang: document.documentElement.lang };
    });
    assert.equal(state.lang, 'ru');
    assert.deepEqual(state.failures, []);
    assert.ok(state.overflow <= 1, `${stage}: horizontal overflow`);
    for (const candidate of state.candidates) {
      if (stage === 'oauth-consent' && candidate.tag === 'BDI' && /(?:^|\s)break-all(?:\s|$)/.test(candidate.className) && candidate.value === baseUrl) continue;
      if (stage === 'device-consent-read-only' && candidate.tag === 'STRONG' && /(?:^|\s)font-mono(?:\s|$)/.test(candidate.className) && candidate.value === deviceCode) continue;
      if (!classifyEnglish(candidate, { companyPrefixes: [seed.company.issuePrefix], userValues })) {
        report.runtimeLeaks.push({ stage, ...candidate });
      }
    }
  };

  try {
    if (!authenticated) {
      // This is evidence of a missing upstream deployment prerequisite. It
      // never converts route-matrix errors into passes or claims auth coverage.
      for (const translated of [false, true]) {
        const context = await browser.newContext();
        if (!translated) await useOriginalOfficialAssets(context, serverDir);
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('response', response => {
            if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/mcp/')) errors.push({ status: response.status(), path: safePath(response.url()) });
          });
          await page.goto(`${baseUrl}/${seed.company.issuePrefix}/apps/assistant-connection`, { waitUntil: 'networkidle' });
          await page.locator('h1').filter({ hasText: /MCP/ }).waitFor();
          const prerequisites = [...new Map(errors.map(item => [`${item.status}:${item.path}`, item])).values()].sort((a, b) => a.path.localeCompare(b.path));
          report.prerequisites.push({ translated, errors: prerequisites });
        } finally { await context.close(); }
      }
      assert.deepEqual(report.prerequisites[1].errors, report.prerequisites[0].errors, 'The same original bundle must exhibit the same unavailable MCP APIs');
      assert.deepEqual(report.prerequisites[0].errors, [
        { status: 404, path: '/api/mcp/connections' }, { status: 404, path: '/api/mcp/setup' },
      ], 'An unconfigured local_trusted runtime has no public MCP management routes');
      report.coverage = 'upstream-prerequisite-only; authenticated consent untested in this mode';
      return;
    }

    const setup = await api('/mcp/setup');
    assert.equal(setup.enabled, true, 'Authenticated QA must explicitly enable Assistant Connection');
    assert.equal(new URL(setup.serverUrl).origin, baseUrl, 'MCP QA must remain on the disposable local instance');
    restoreCompanyName = (await api(`/companies/${seed.company.id}`)).name;
    await api(`/companies/${seed.company.id}`, 'PATCH', { name: 'Dashboard' });
    const callback = `${baseUrl}/qa-mcp-callback`;
    const originalConnections = new Set((await api('/mcp/connections')).map(connection => connection.id));
    const outcomes = [];
    for (const translated of [false, true]) {
      const context = await browser.newContext({ ...officialBrowserOptions(), viewport: { width: 1440, height: 900 } });
      if (!translated) await useOriginalOfficialAssets(context, serverDir);
      await context.route(`${callback}**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>QA callback</title>' }));
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push({ type: 'pageerror', message: String(error) }));
        page.on('response', response => { if (response.status() >= 400) errors.push({ type: 'http', status: response.status(), path: safePath(response.url()) }); });
        const check = async (stage, expectedValues) => {
          if (translated) await audit(page, stage, expectedValues);
          report.scenarios.push({ translated, stage });
        };
        await page.goto(`${baseUrl}/${seed.company.issuePrefix}/apps/assistant-connection`, { waitUntil: 'networkidle' });
        await page.locator('details > summary').waitFor();
        await page.locator('details > summary').click();
        assert.equal(await page.locator('details section > p.text-sm > strong').first().innerText(), 'Dashboard', 'Setup instructions preserve the selected organization name');
        await check('assistant-setup-manual');
        const setupBytes = await page.locator('pre').allTextContents();

        const client = await requestJson('/mcp/oauth/register', { method: 'POST', body: {
          client_name: officialAssistantClientName, redirect_uris: [callback], token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', DEVICE_GRANT], response_types: ['code'],
        } });
        const verifier = randomBytes(32).toString('base64url');
        const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code',
          resource: setup.serverUrl, scope: 'paperclip:read paperclip:write',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        const authorize = await request(`/mcp/oauth/authorize?${query}`, { redirect: 'manual' });
        assert.equal(authorize.status, 303);
        const consentUrl = new URL(authorize.headers.get('location'), baseUrl);
        assert.equal(consentUrl.origin, baseUrl);
        assert.match(consentUrl.pathname, /^\/mcp-connect\//);
        await page.goto(consentUrl.href, { waitUntil: 'networkidle' });
        await page.locator('#mcp-allow-writes').waitFor();
        assert.equal(await page.locator('h1 bdi').innerText(), 'Dashboard', 'OAuth client names are user content');
        assert.equal(await page.locator('input[type="radio"][name="company"]').getAttribute('aria-label'), 'Dashboard', 'The organization choice preserves its accessible data label');
        assert.equal(await page.locator('label > span.break-words.font-medium').innerText(), 'Dashboard', 'The organization choice preserves its visible name');
        await check('oauth-consent');
        // Deny the code flow: the local callback proves navigation without
        // sending a request to an external assistant or exchanging any token.
        const consentResponse = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/mcp\/requests\/[^/]+\/consent$/.test(new URL(response.url()).pathname));
        await page.locator('[data-slot="card"]').getByRole('button').first().click();
        const denied = await consentResponse;
        assert.equal(denied.status(), 200);
        await page.waitForURL(`${callback}**`);
        assert.equal(new URL(page.url()).searchParams.get('error'), 'access_denied');

        const device = await requestJson('/mcp/oauth/device_authorization', { method: 'POST', body: {
          client_id: client.client_id, resource: setup.serverUrl, scope: 'paperclip:read paperclip:write', company_id: seed.company.id,
        } });
        await page.goto(`${baseUrl}/mcp-device`, { waitUntil: 'networkidle' });
        await page.locator('#device-code').fill(device.user_code);
        assert.equal(await page.locator('#device-code').inputValue(), device.user_code);
        await check('device-code-entry');
        await page.locator('form button[type="submit"]').click();
        const writes = page.locator('#mcp-allow-writes');
        await writes.waitFor();
        assert.equal(await page.locator('h1 bdi').innerText(), 'Dashboard', 'Device client names are user content');
        assert.equal(await page.locator('p.break-words.text-lg.font-semibold').innerText(), 'Dashboard', 'Pinned organization names are user content');
        assert.equal(await page.locator('strong.font-mono').innerText(), device.user_code);
        await writes.click();
        assert.equal(await writes.getAttribute('aria-checked'), 'false', 'The read-only consent choice must be retained');
        await check('device-consent-read-only', { deviceCode: device.user_code });
        const approvedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/mcp/device/consent');
        await page.locator('[data-slot="card"]').getByRole('button').last().click();
        const approved = await approvedResponse;
        assert.equal(approved.status(), 200);
        assert.equal((await approved.json()).status, 'approved');
        const consentPayload = approved.request().postDataJSON();
        assert.equal(consentPayload.allowWrites, false);
        assert.equal(consentPayload.companyId, seed.company.id);
        await page.locator('#mcp-allow-writes').waitFor({ state: 'detached' });
        await check('device-approved');

        const grant = (await api('/mcp/connections')).find(connection => !originalConnections.has(connection.id) && !connection.revokedAt && connection.clientName === 'Dashboard');
        assert.ok(grant, 'The actual device consent must create the test grant');
        ownedGrants.add(grant.id);
        assert.equal(grant.companyId, seed.company.id);
        assert.ok(grant.scopes.includes('paperclip:read') && !grant.scopes.includes('paperclip:write'));
        await page.goto(`${baseUrl}/assistant-connections`, { waitUntil: 'networkidle' });
        // A revoked grant has another muted paragraph for its status. Only
        // the paragraph immediately after the client heading contains the
        // organization name; baseline grants remain visible on the next pass.
        const organizationRows = page.locator('[data-slot="card"] > h2 + p.text-sm.text-muted-foreground');
        await organizationRows.first().waitFor({ state: 'visible' });
        assert.ok((await page.locator('h2').allTextContents()).includes('Dashboard'), 'Connection names must preserve dictionary-key user values');
        const organizationLabels = await organizationRows.allTextContents();
        assert.ok(organizationLabels.length > 0, 'The actual grant rows must be rendered');
        assert.ok(organizationLabels.every(text => text.split(':').slice(1).join(':').trim() === 'Dashboard'), 'Management rows preserve organization names after the translated label');
        await check('assistant-connections');
        await page.setViewportSize({ width: 390, height: 844 });
        await check('assistant-connections-mobile');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${baseUrl}/${seed.company.issuePrefix}/apps/assistant-connection`, { waitUntil: 'networkidle' });
        assert.ok((await page.locator('p.font-medium').allTextContents()).includes('Dashboard'), 'The setup page preserves connected client names');
        await check('assistant-setup-connected');
        await page.goto(`${baseUrl}/${seed.company.issuePrefix}/apps`, { waitUntil: 'networkidle' });
        assert.ok((await page.locator('[data-app-slug="assistant-connection"]').innerText()).includes('Dashboard'), 'The gallery preserves connected client names');
        const revoke = await request(`/api/mcp/connections/${grant.id}`, { method: 'DELETE', session: true });
        assert.equal(revoke.status, 204);
        ownedGrants.delete(grant.id);
        const revoked = (await api('/mcp/connections')).find(connection => connection.id === grant.id);
        assert.ok(revoked?.revokedAt, 'The QA connection must be revoked');
        assert.deepEqual(errors, [], 'Assistant setup and consent must have no page or HTTP errors');
        outcomes.push({ setupBytes, grantedScopes: [...grant.scopes].sort(), denied: 'access_denied', consent: { allowWrites: consentPayload.allowWrites, companyId: consentPayload.companyId } });
      } finally { await context.close(); }
    }
    assert.deepEqual(outcomes[1], outcomes[0], 'Translations must preserve setup commands and both native consent decisions');
    assert.equal((await api(`/agents/${seed.agent.id}`)).status, 'paused', 'QA consent must not activate the test agent');
    assert.deepEqual(report.runtimeLeaks, [], 'See assistant-connection.json for untranslated setup or consent chrome');
    report.coverage = 'authenticated owner; setup; OAuth deny; device read-only approval; revoke';
  } finally {
    for (const id of ownedGrants) await request(`/api/mcp/connections/${id}`, { method: 'DELETE', session: true });
    if (restoreCompanyName !== undefined) await api(`/companies/${seed.company.id}`, 'PATCH', { name: restoreCompanyName });
    await browser.close();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'assistant-connection.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
});
