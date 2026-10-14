import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { request } from 'playwright';

export const officialAuthenticated = () => /^(1|true)$/i.test(process.env.PAPERCLIP_TEST_AUTHENTICATED || '');

export function officialBrowserOptions() {
  const storageState = process.env.PAPERCLIP_TEST_STORAGE_STATE;
  assert.ok(!officialAuthenticated() || storageState, 'Authenticated QA requires its disposable browser session');
  return storageState ? { storageState } : {};
}

export function officialCookieHeader(baseUrl) {
  const { storageState } = officialBrowserOptions();
  if (!storageState) return {};
  const url = new URL(baseUrl);
  const state = JSON.parse(fs.readFileSync(storageState, 'utf8'));
  const cookies = state.cookies.filter(cookie => cookie.domain === url.hostname && cookie.path === '/');
  assert.ok(cookies.length, 'The QA session must belong to the explicit local test server');
  return { cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') };
}

// The unpatched comparison always serves the same installed release's saved
// original assets. It does not touch the live bundle or a production server.
export async function useOriginalOfficialAssets(context, serverDir) {
  await context.route('**/assets/*', async route => {
    const rel = new URL(route.request().url()).pathname.slice(1);
    if (rel === 'assets/paperclip-ru-overlay.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
    const original = path.join(serverDir, 'ui-dist', '.paperclip-ru', 'baseline', rel);
    if (fs.existsSync(original)) return route.fulfill({ path: original, contentType: 'text/javascript' });
    return route.continue();
  });
}

// Only the explicit authenticated QA mode calls this, on an empty disposable
// database. The random password stays in memory; the session file stays inside
// the gate's temporary runtime and is removed with it.
export async function bootstrapOfficialAuth(baseUrl, storageState) {
  const url = new URL(baseUrl);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const context = await request.newContext({ baseURL: url.origin, extraHTTPHeaders: { origin: url.origin } });
  try {
    const healthResponse = await context.get('/api/health');
    assert.equal(healthResponse.status(), 200);
    const health = await healthResponse.json();
    assert.equal(health.deploymentMode, 'authenticated', 'QA bootstrap requires the explicit authenticated runtime');
    assert.equal(health.deploymentExposure, 'private', 'First-owner QA bootstrap is private and local');
    assert.equal(health.bootstrapStatus, 'bootstrap_pending', 'Refuse to create a QA account in an already claimed instance');
    const signUp = await context.post('/api/auth/sign-up/email', { data: {
      name: 'Release QA Owner', email: `release-qa-${randomBytes(8).toString('hex')}@example.invalid`,
      password: randomBytes(32).toString('base64url'),
    } });
    assert.equal(signUp.status(), 200, 'The disposable QA owner must sign up successfully');
    const claim = await context.post('/api/bootstrap/claim', { data: {} });
    assert.equal(claim.status(), 200, 'Authenticated QA needs an empty database for the first-owner claim');
    assert.equal((await claim.json()).claimed, true);
    const owner = (await signUp.json()).user;
    assert.ok(owner?.id && owner?.email, 'The QA owner identity must be returned');
    const state = await context.storageState({ path: storageState });
    assert.ok(state.cookies.length, 'Sign-up must create a real session cookie');
    return { name: owner.name, email: owner.email };
  } finally {
    await context.dispose();
  }
}
