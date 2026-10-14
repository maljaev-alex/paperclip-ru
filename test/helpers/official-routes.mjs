import assert from 'node:assert/strict';

function stableAtLeast(version, minimum) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== required[i]) return actual[i] > required[i];
  }
  return true;
}

// These are additions to tools/routes.json. Keep the legacy inventory usable
// on the August builds, while requiring the real surfaces of newer stables.
export function officialRoutePlan({ version, seed, settings, authenticated = false }) {
  const prefix = `/${seed.company.issuePrefix}`;
  const agent = `${prefix}/agents/${seed.agent.id}`;
  const project = `${prefix}/projects/${seed.project.id}`;
  const agentRef = `${prefix}/agents/${encodeURIComponent(seed.agent.urlKey || seed.agent.id)}`;
  const projectRef = `${prefix}/projects/${encodeURIComponent(seed.project.urlKey || seed.project.id)}`;
  const extraRoutes = [
    `${prefix}/issues?view=board`, `${prefix}/issues/${seed.issues[0].identifier}`, project,
    ...['dashboard', 'instructions', 'skills', 'configuration', 'secrets', 'tools', 'runs', 'audit', 'budget'].map(tab => `${agent}/${tab}`),
  ];
  const destinations = [];
  const requireRoute = (route, finalPath = route.split('?')[0]) => {
    extraRoutes.push(route);
    destinations.push({ route, finalPath });
  };

  // Do not infer absence from a failed seed: September and later official
  // builds must expose and enable these capabilities before any browser run.
  if (stableAtLeast(version, '2026.916.0')) {
    assert.equal(settings?.enableAgentChat, true, 'The official seed must enable Agent Chat');
    assert.equal(settings?.enableChatConnectors, true, 'The official seed must enable Chat Connectors');
    assert.ok(seed.conversation?.id, 'The official seed must create a real conversation');
    requireRoute(`${prefix}/chats/${seed.agent.id}`, `${prefix}/chats/${encodeURIComponent(seed.agent.urlKey || seed.agent.id)}`);
    requireRoute(`${prefix}/apps/chat/connect`);
    for (const tab of ['permissions', 'api-keys', 'revisions']) requireRoute(`${agent}/${tab}`, `${agentRef}/${tab}`);
  }

  if (stableAtLeast(version, '2026.1005.0')) {
    assert.equal(settings?.enableStreamlinedUi, true, 'The October route inventory requires the default streamlined UI');
    for (const route of [
      '/skills/sources', '/skills/sources/new', '/skills/studio/new',
      '/apps/byo', '/apps/connect?source=github', '/apps/advanced/profiles', '/apps/advanced/profiles/new',
      '/company/settings/instance/environments/new', '/activity/runs', '/activity/budgets',
    ]) requireRoute(`${prefix}${route}`);
    requireRoute(`${agent}/channels`, `${agentRef}/channels`);
    for (const tab of ['configuration', 'budget']) requireRoute(`${project}/${tab}`, `${projectRef}/${tab}`);

    // The aliases are still exercised, but a redirect to a dashboard or a
    // disabled feature must not count as coverage of the intended surface.
    for (const [route, finalPath] of [
      ['/apps/connections', '/apps'], ['/company/settings/invites', '/company/settings/members'],
      ['/company/settings/instance/general', '/company/settings'],
      ['/company/settings/instance/heartbeats', '/company/settings'],
      ['/org', '/agents/all'], ['/timeline', '/activity/timeline'], ['/costs', '/activity/costs'],
    ]) destinations.push({ route: `${prefix}${route}`, finalPath: `${prefix}${finalPath}` });
    for (const [tab, target] of [['dashboard', 'overview'], ['configuration', 'runtime']]) {
      destinations.push({ route: `${agent}/${tab}`, finalPath: `${agentRef}/${target}` });
    }
    for (const [tab, target] of [['runs', '/activity/runs'], ['audit', '/activity'], ['budget', '/activity/budgets']]) {
      destinations.push({ route: `${agent}/${tab}`, finalPath: `${prefix}${target}` });
    }
  }

  if (stableAtLeast(version, '2026.1012.0') && authenticated) {
    assert.equal(settings?.enablePublicMcp, true, 'Authenticated QA must enable public MCP on the disposable instance');
    requireRoute(`${prefix}/apps/assistant-connection`);
  }
  return { extraRoutes, destinations };
}

export function assertOfficialRouteDestinations(matrix, plan) {
  for (const expected of plan.destinations) {
    const actual = matrix.routes.find(entry => entry.route === expected.route);
    assert.ok(actual, `The mandatory route was not audited: ${expected.route}`);
    assert.equal(actual.finalPath, expected.finalPath, `The intended surface must be reached: ${expected.route}`);
  }
}

export const supportsPublicMcp = version => stableAtLeast(version, '2026.1012.0');

export function validateOfficialBrowserSuite({ version, browserSuite, artifact = false }) {
  assert.ok(['all', 'assistant-connection'].includes(browserSuite), 'PAPERCLIP_TEST_SUITE must be all or assistant-connection');
  assert.ok(!artifact || browserSuite === 'all', 'Release artifact validation requires the complete official browser suite');
  assert.ok(browserSuite !== 'assistant-connection' || supportsPublicMcp(version), 'The assistant diagnostic requires an official release with public MCP');
}
