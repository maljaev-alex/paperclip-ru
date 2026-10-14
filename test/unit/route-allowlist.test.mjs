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

test('only the two observed MCP audit codes pass in the exact technical audit context', () => {
  const context = { route: '/CMP/activity', tag: 'SPAN', className: 'font-mono text-(length:--text-micro) opacity-70' };
  for (const value of ['mcp.connection_authorized', 'mcp.connection_revoked']) {
    assert.equal(classifyEnglish({ ...context, value }), 'audit-event-code');
    for (const change of [{ route: '/CMP/dashboard' }, { tag: 'H2' }, { className: 'font-mono' }, { attribute: 'title' }]) {
      assert.equal(classifyEnglish({ ...context, ...change, value }), null);
    }
  }
  for (const value of ['mcp.connection_other', 'mcp_connection', 'mcp connection revoked']) assert.equal(classifyEnglish({ ...context, value }), null);
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
    member('local-board', { name: '  Board  ', email: 'local@paperclip.local' }),
    member('custom', { name: 'Save', email: 'owner@example.invalid' }),
    member('email-only', { name: ' ', email: ' qa@example.invalid ' }),
    member('missing', null), member('inactive', { name: 'Unknown' }, { status: 'archived' }),
    member('agent', { name: 'Settings' }, { principalType: 'agent' }),
  ] }), [
    { id: 'local-board', label: 'Board' }, { id: 'custom', label: 'Save' }, { id: 'email-only', label: 'qa@example.invalid' },
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
