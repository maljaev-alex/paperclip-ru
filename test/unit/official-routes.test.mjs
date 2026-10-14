import test from 'node:test';
import assert from 'node:assert/strict';
import { officialRoutePlan, assertOfficialRouteDestinations, validateOfficialBrowserSuite } from '../helpers/official-routes.mjs';
import { classifyEnglish } from '../helpers/route-allowlist.mjs';

const seed = {
  company: { issuePrefix: 'QA' }, agent: { id: 'agent-id', urlKey: 'agent-id' },
  project: { id: 'project-id', urlKey: 'project-key' }, issues: [{ identifier: 'QA-1' }],
  conversation: { id: 'conversation-id' },
};
const settings = { enableAgentChat: true, enableChatConnectors: true, enableStreamlinedUi: true, enablePublicMcp: true };

test('later stable releases cannot silently lose the September chat and governance routes', () => {
  for (const version of ['2026.916.0', '2026.916.1', '2026.1001.0', '2026.1005.0', '2026.1012.0']) {
    const plan = officialRoutePlan({ version, seed, settings });
    for (const route of ['/QA/chats/agent-id', '/QA/apps/chat/connect',
      '/QA/agents/agent-id/permissions', '/QA/agents/agent-id/api-keys', '/QA/agents/agent-id/revisions']) {
      assert.ok(plan.extraRoutes.includes(route), `${version}: ${route}`);
    }
    assert.throws(() => officialRoutePlan({ version, seed: { ...seed, conversation: null }, settings }), /real conversation/);
    assert.throws(() => officialRoutePlan({ version, seed, settings: { ...settings, enableAgentChat: false } }), /Agent Chat/);
  }
});

test('August builds and the previous stable keep their verified route inventories', () => {
  for (const version of ['2026.817.0', '2026.824.0', '2026.824.1', '2026.831.0', '2026.831.1']) {
    const plan = officialRoutePlan({ version, seed: { ...seed, conversation: null }, settings: {} });
    assert.equal(plan.extraRoutes.length, 12);
  }
  assert.equal(officialRoutePlan({ version: '2026.1001.0', seed, settings }).extraRoutes.length, 17);
});

test('October audits reach new forms and reject a silent redirect away from an expected page', () => {
  const plan = officialRoutePlan({ version: '2026.1012.0', seed, settings, authenticated: true });
  for (const route of ['/QA/skills/sources/new', '/QA/skills/studio/new', '/QA/agents/agent-id/channels',
    '/QA/apps/advanced/profiles/new', '/QA/company/settings/instance/environments/new',
    '/QA/projects/project-id/configuration', '/QA/projects/project-id/budget', '/QA/apps/assistant-connection']) {
    assert.ok(plan.extraRoutes.includes(route), route);
  }
  const matrix = { routes: plan.destinations.map(entry => ({ ...entry })) };
  assertOfficialRouteDestinations(matrix, plan);
  matrix.routes.find(entry => entry.route.endsWith('/channels')).finalPath = '/QA/dashboard';
  assert.throws(() => assertOfficialRouteDestinations(matrix, plan), /intended surface/);
  assert.equal(officialRoutePlan({ version: '2026.1005.0', seed, settings, authenticated: true }).extraRoutes.some(r => r.endsWith('/assistant-connection')), false);
});

test('assistant diagnostics cannot stand in for artifact validation or pass an entirely skipped older release', () => {
  validateOfficialBrowserSuite({ version: '2026.1012.0', browserSuite: 'assistant-connection' });
  validateOfficialBrowserSuite({ version: '2026.1005.0', browserSuite: 'all', artifact: true });
  assert.throws(() => validateOfficialBrowserSuite({ version: '2026.1012.0', browserSuite: 'assistant-connection', artifact: true }), /complete official browser suite/);
  assert.throws(() => validateOfficialBrowserSuite({ version: '2026.1005.0', browserSuite: 'assistant-connection' }), /public MCP/);
  assert.throws(() => validateOfficialBrowserSuite({ version: '2026.1012.0', browserSuite: 'unknown' }), /PAPERCLIP_TEST_SUITE/);
});

test('persisted QA assistant names are accepted only in the identified client-name surface', () => {
  const options = { assistantClientNames: ['Dashboard'] };
  assert.equal(classifyEnglish({ value: 'Dashboard', tag: 'P', context: 'assistant-client-name' }, options), 'seeded-assistant-client-name');
  assert.equal(classifyEnglish({ value: 'Dashboard', tag: 'H1' }, options), null);
  assert.equal(classifyEnglish({ value: 'Settings', tag: 'P', context: 'assistant-client-name' }, options), null);
});
