import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEnglish } from '../helpers/route-allowlist.mjs';
import { activityActorsFromMembers } from '../helpers/official-seed.mjs';

test('known connector products and technical terms cannot conceal untranslated operator sentences', () => {
  for (const name of ['Browser Use Cloud', 'Fireflies', 'Neon', 'GitHub Code Review Bot', 'Mem0', 'Zep', 'Supermemory', 'Cognee', 'Honcho']) {
    assert.ok(classifyEnglish({ value: name }));
    assert.ok(classifyEnglish({ value: `\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c ${name}` }));
    assert.equal(classifyEnglish({ value: `Connect ${name}` }), null);
    assert.equal(classifyEnglish({ value: `\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c ${name} connection required` }), null);
    assert.equal(classifyEnglish({ value: `\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c ${name}x` }), null);
    assert.equal(classifyEnglish({ value: `\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c x${name}` }), null);
  }
  for (const term of ['Postgres', 'SQL', 'LAN', 'VPN', 'HEX', 'slug']) {
    assert.ok(classifyEnglish({ value: `\u0424\u043e\u0440\u043c\u0430\u0442: ${term}` }));
    assert.equal(classifyEnglish({ value: `\u0424\u043e\u0440\u043c\u0430\u0442: ${term} unavailable` }), null);
  }
  assert.equal(classifyEnglish({ value: 'slack' }), 'upstream-skill-identifier');
  assert.equal(classifyEnglish({ value: 'slack unavailable' }), null);
  assert.equal(classifyEnglish({ value: '\u0424\u043e\u0440\u043c\u0430\u0442: PLAN' }), null);
  assert.equal(classifyEnglish({ value: '\u0424\u043e\u0440\u043c\u0430\u0442: VPNx' }), null);
});

test('only the observed raw codes and types pass in their technical audit contexts', () => {
  const context = { route: '/CMP/activity', tag: 'SPAN', className: 'font-mono text-(length:--text-micro) opacity-70', context: 'audit-event-code' };
  for (const value of ['mcp.connection_authorized', 'mcp.connection_revoked', 'agent.identity.created', 'primary_agent.initialized',
    'issue.document_created', 'issue.created', 'issue.read_marked', 'issue.conversation_opened', 'company.updated', 'company.created',
    'project.created', 'agent.paused', 'agent.created', 'budget.policy_upserted']) {
    assert.equal(classifyEnglish({ ...context, value }), 'audit-event-code');
    for (const change of [{ route: '/CMP/dashboard' }, { tag: 'H2' }, { className: 'font-mono' }, { attribute: 'title' }, { context: undefined }]) {
      assert.equal(classifyEnglish({ ...context, ...change, value }), null);
    }
  }
  for (const value of ['mcp.connection_other', 'mcp_connection', 'mcp connection revoked', 'issue.updated', 'issue.created - failed']) {
    assert.equal(classifyEnglish({ ...context, value }), null);
  }
  const entity = { ...context, value: 'user_preference', context: 'audit-entity-type', className: 'text-muted-foreground' };
  assert.equal(classifyEnglish(entity), 'audit-entity-type');
  assert.equal(classifyEnglish({ ...entity, context: undefined }), null);
  assert.equal(classifyEnglish({ ...entity, route: '/CMP/skills' }), null);
  assert.equal(classifyEnglish({ ...entity, value: 'other_preference' }), null);
});

test('an ambiguous connector name only exempts the matching catalogue card or translated card chrome', () => {
  const heading = { route: '/CMP/apps/connections', tag: 'H2', context: 'app-catalog-heading', appName: 'Make', appSlug: 'make' };
  assert.equal(classifyEnglish({ ...heading, value: 'Make' }), 'catalog-product-name');
  assert.equal(classifyEnglish({ ...heading, value: 'Make', appName: 'Gauge' }), null);
  assert.equal(classifyEnglish({ ...heading, value: 'Make', route: '/CMP/tasks' }), null);
  assert.equal(classifyEnglish({ value: 'Make' }), null);
  const chrome = { ...heading, tag: 'P', context: 'app-catalog-chrome' };
  assert.equal(classifyEnglish({ ...chrome, value: 'Подключить Make' }), 'translated-text-with-known-name');
  assert.equal(classifyEnglish({ ...chrome, value: 'Подключить Make', context: undefined }), null);
  assert.equal(classifyEnglish({ ...chrome, value: 'Подключить Make now' }), null);
  assert.equal(classifyEnglish({ ...chrome, value: 'Connect Make' }), null);
  assert.equal(classifyEnglish({ value: 'Подключить Dot', route: '/CMP/issues' }), null);
  assert.equal(classifyEnglish({ value: 'Подключить Dot', route: '/CMP/company/settings/instance/experimental' }), 'translated-text-with-known-name');
  assert.equal(classifyEnglish({ value: 'Открыть Docs', route: '/CMP/issues' }), null);
  const responses = { ...chrome, appName: 'Responses API', appSlug: 'responses-api' };
  const description = 'Шлюз OpenAI Responses API, например Emissary.';
  assert.equal(classifyEnglish({ ...responses, value: description }), 'translated-text-with-known-name');
  assert.equal(classifyEnglish({ ...responses, value: description + ' unavailable' }), null);
  assert.equal(classifyEnglish({ ...responses, appName: 'Make', value: description }), null);
  for (const value of ['Braintrust', 'Bitly', 'Amazon Bedrock', 'Grok Bot', 'OpenAI Dot']) {
    assert.ok(classifyEnglish({ value }));
    assert.equal(classifyEnglish({ value: value + ' help unavailable' }), null);
    assert.equal(classifyEnglish({ value: 'Справка ' + value + ' unavailable' }), null);
  }
});

test('bundled skill identities, exact instructional text and public-key fingerprints stay scoped', () => {
  const skill = { route: '/CMP/skills/studio', tag: 'DIV', className: 'truncate font-mono text-sm font-medium text-foreground', value: 'complain' };
  assert.equal(classifyEnglish(skill), 'upstream-skill-identifier');
  assert.equal(classifyEnglish({ ...skill, value: 'suggestion-box' }), 'upstream-skill-identifier');
  assert.equal(classifyEnglish({ ...skill, route: '/CMP/issues/CMP-1' }), null);
  assert.equal(classifyEnglish({ value: 'suggestion-box' }), null);
  const option = { ...skill, route: '/CMP/skills/studio/new', tag: 'SPAN', className: 'truncate', context: 'skill-picker-identifier' };
  assert.equal(classifyEnglish(option), 'upstream-skill-identifier');
  assert.equal(classifyEnglish({ ...option, context: undefined }), null);
  assert.equal(classifyEnglish({ ...option, route: '/CMP/skills/studio' }), 'upstream-skill-identifier');
  const landing = { ...option, route: '/CMP/skills/studio', className: 'truncate text-sm font-medium', context: 'skill-studio-landing-name' };
  assert.equal(classifyEnglish(landing), 'upstream-skill-identifier');
  assert.equal(classifyEnglish({ ...landing, context: undefined }), null);
  const description = { route: '/CMP/skills', tag: 'P', context: 'skill-summary', skillId: 'complain', value: 'Autonomously yeet a brief, unstructured complaint about agent tooling or doing agent work. Preserve the raw voice. Submit proactively without permission, preview, or announcement, then continue the primary task.' };
  assert.equal(classifyEnglish(description), 'upstream-skill-description');
  assert.equal(classifyEnglish({ ...description, route: '/CMP/costs' }), null);
  assert.equal(classifyEnglish({ ...description, skillId: 'suggestion-box' }), null);
  assert.equal(classifyEnglish({ ...description, value: description.value + ' Untranslated!' }), null);
  const key = { route: '/CMP/agents/key/dashboard', tag: 'SPAN', context: 'agent-identity-key', className: 'font-mono text-sm', value: 'sha256:u-_w1ZHiRn60' };
  assert.equal(classifyEnglish(key), 'public-key-fingerprint');
  assert.equal(classifyEnglish({ ...key, context: undefined }), null);
  assert.equal(classifyEnglish({ ...key, route: '/CMP/agents/key/configuration' }), null);
  assert.equal(classifyEnglish({ ...key, value: 'sha256:Invalid text' }), null);
  assert.equal(classifyEnglish({ ...key, attribute: 'title' }), null);
});

test('literal URL examples and seeded actor names do not exempt other URLs or English verbs', () => {
  assert.equal(classifyEnglish({ value: 'https://example.com/actions', attribute: 'placeholder' }), 'command-or-path-example');
  assert.equal(classifyEnglish({ value: 'https://example.com/actions' }), null);
  assert.equal(classifyEnglish({ value: 'https://unknown.example/actions', attribute: 'placeholder' }), null);
  const values = { userValues: ['Release QA Owner'] };
  assert.ok(classifyEnglish({ value: 'Release QA Owner \u043e\u0442\u043e\u0437\u0432\u0430\u043b \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 MCP', attribute: 'title' }, values));
  assert.equal(classifyEnglish({ value: 'Release QA Owner revoked', attribute: 'title' }, values), null);
  assert.equal(classifyEnglish({ value: 'Release QA Owner read', attribute: 'title' }, values), null);
});

test('activity identities come from active API profiles without inventing a Board fallback', () => {
  const member = (principalId, user, extra = {}) => ({ principalId, principalType: 'user', status: 'active', user, ...extra });
  assert.deepEqual(activityActorsFromMembers({ members: [
    member('local-board', { name: '  Board  ', email: 'local\u0040paperclip.local' }),
    member('custom', { name: 'Save', email: 'owner\u0040example.invalid' }),
    member('email-only', { name: ' ', email: ' qa\u0040example.invalid ' }),
    member('missing', null), member('inactive', { name: 'Unknown' }, { status: 'archived' }),
    member('agent', { name: 'Settings' }, { principalType: 'agent' }),
  ] }), [
    { id: 'local-board', label: 'Board' }, { id: 'custom', label: 'Save' }, { id: 'email-only', label: 'qa\u0040example.invalid' },
  ]);
  assert.deepEqual(activityActorsFromMembers({ members: [member('local-board', null)] }), []);
  assert.throws(() => activityActorsFromMembers({}), /company members/);
});

test('API actor names are allowed only in ActivityRow data and translated title prefixes', () => {
  const options = { activityActors: [{ id: 'local-board', label: 'Board' }, { id: 'custom', label: 'Save' }, { id: 'verb-name', label: 'created' }] };
  const name = { route: '/CMP/dashboard', tag: 'SPAN', className: '', context: 'activity-actor-name' };
  const title = { ...name, className: 'max-w-1/2 shrink-0 truncate', context: 'activity-actor-title', attribute: 'title' };
  for (const actorName of ['Board', 'Save', 'created']) {
    assert.equal(classifyEnglish({ ...name, value: actorName }, options), 'api-activity-actor-name');
    for (const action of ['\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b', '\u0441\u043e\u0437\u0434\u0430\u043d\u043e', '\u0441\u043e\u0437\u0434\u0430\u043b \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u0434\u043b\u044f \u0437\u0430\u0434\u0430\u0447\u0438']) {
      assert.equal(classifyEnglish({ ...title, actorName, value: `${actorName} ${action}` }, options), 'api-activity-actor-with-translated-action');
    }
    for (const action of ['read', 'created', '\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b failed', '\u0441\u043e\u0437\u0434\u0430\u043d\u043e created']) {
      assert.equal(classifyEnglish({ ...title, actorName, value: `${actorName} ${action}` }, { ...options, userValues: ['created', 'failed'] }), null);
    }
  }
  for (const change of [{ context: undefined }, { route: '/CMP/issues' }, { tag: 'H1' }, { attribute: 'aria-label' }]) {
    assert.equal(classifyEnglish({ ...name, ...change, value: 'Board' }, options), null);
  }
  assert.equal(classifyEnglish({ ...name, value: 'Settings' }, options), null);
  assert.equal(classifyEnglish({ ...title, actorName: 'Save', value: 'Board \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b' }, options), null);
  assert.equal(classifyEnglish({ value: 'Board \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b', attribute: 'title' }, options), null);
});
