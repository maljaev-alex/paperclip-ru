import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadDictionary } from '../../tools/lib/dictionary.mjs';
import { patchActivityActorFallbacks } from '../../tools/lib/overlay.mjs';
import { activityRowSource } from '../helpers/activity-row-fixture.mjs';

test('ActivityRow fallback patch changes only source UI defaults and preserves every dynamic name source', () => {
  const dictionary = loadDictionary().exact;
  const patched = patchActivityActorFallbacks(activityRowSource, dictionary);
  assert.equal(patched.patched, true);
  assert.equal(patchActivityActorFallbacks(patched.code, dictionary).code, patched.code);
  const context = { window: {} };
  vm.runInNewContext(patched.code, context);
  for (const name of ['Dashboard', 'Board', 'System', 'Unknown', 'mcp connection revoked']) {
    assert.equal(context.window.qaActor({ actorType: 'agent' }, { name }).name, name);
    assert.equal(context.window.qaActor({ actorType: 'user' }, null, { label: name }).name, name);
    assert.equal(context.window.qaActor({ actorType: 'other', actorId: name }).name, name);
  }
  for (const [type, key] of [['system', 'System'], ['user', 'Board'], ['other', 'Unknown']]) {
    assert.equal(context.window.qaActor({ actorType: type }).name, dictionary.get(key));
  }
});

test('unreviewed actor resolution or name-leaf shapes are not patched', () => {
  const dictionary = loadDictionary().exact;
  for (const source of [
    activityRowSource.replace('g?.label', 'g?.displayName'),
    activityRowSource.replace('max-w-1/2 shrink-0 truncate', 'truncate'),
    activityRowSource.replace('"Unknown"', '"Anonymous"'),
    activityRowSource + activityRowSource,
  ]) assert.deepEqual(patchActivityActorFallbacks(source, dictionary), { code: source, patched: false });
  assert.deepEqual(patchActivityActorFallbacks(activityRowSource, new Map()), { code: activityRowSource, patched: false });
});
