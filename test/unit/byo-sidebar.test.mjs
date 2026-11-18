import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchByoAppSidebar, splitByoSidebarChanges } from '../../tools/lib/overlay.mjs';

function fixture(assistant = false) {
  const primary = ['browse', 'connections', ...(assistant ? ['assistant-connection'] : []), 'connect', 'chat', 'vercel-connect', 'review', 'attention', 'gateways', 'advanced', 'app'];
  const legacy = ['browse', 'connections', 'connect', 'chat', 'review', 'attention', 'gateways', 'advanced', 'app'];
  return `var route={path:"apps/byo"};var Primary=new Set(${JSON.stringify(primary)});function modern(P){var U=P[0]?.toLowerCase()==="apps",H=U&&P[1]&&!Primary.has(P[1].toLowerCase())?P[1]:null;return H}var Legacy=new Set(${JSON.stringify(legacy)});function legacy(T){var D=T[0]?.toLowerCase()==="apps",O=D&&T[1]&&!Legacy.has(T[1].toLowerCase())?T[1]:null;return O}`;
}

test('the lazy production layout and its importer are patched together', () => {
  const [primary, production] = fixture(true).split('var Legacy=');
  const entry = 'assets/index-abc.js';
  const layout = 'assets/Layout.production-def.js';
  const live = new Map([[entry, primary + ';import("./Layout.production-def.js").then(x=>({default:x.Layout}))'],
    [layout, 'var Legacy=' + production]]);
  const changes = splitByoSidebarChanges(live);
  assert.equal(changes.size, 2);
  for (const [file, value] of changes) {
    assert.equal(value, live.get(file).replace('"browse","connections"', '"browse","connections","byo"'));
  }
  assert.equal(splitByoSidebarChanges(changes).size, 0);
  for (const broken of [new Map([[entry, live.get(entry)]]),
    new Map([[entry, live.get(entry)], [layout, live.get(layout).replace('Legacy.has', 'Unknown.has')]]),
    new Map([[entry, live.get(entry).replace('apps/byo', 'apps/account')], [layout, live.get(layout)]])]) {
    assert.equal(splitByoSidebarChanges(broken).size, 0);
  }
});

test('known October app classifiers stop requesting a connection called byo while ordinary IDs remain unchanged', () => {
  for (const assistant of [false, true]) {
    const source = fixture(assistant);
    const before = vm.runInNewContext(`${source};[modern(["apps","byo"]),legacy(["apps","byo"])]`);
    assert.deepEqual(Array.from(before), ['byo', 'byo']);
    const result = patchByoAppSidebar(source);
    assert.equal(result.patched, true);
    assert.equal(result.replacements, 2);
    for (const classify of ['modern', 'legacy']) {
      const values = vm.runInNewContext(`${result.code};[${classify}(["apps","byo"]),${classify}(["apps","connection-123"]),${classify}(["apps","byo-account"]),${classify}(["apps","connect"]),${classify}(["issues","byo"])]`);
      assert.deepEqual(Array.from(values), [null, 'connection-123', 'byo-account', null, null]);
    }
    assert.equal(patchByoAppSidebar(result.code).code, result.code);
    assert.equal(patchByoAppSidebar(result.code).replacements, 0);
  }
});

test('unknown route, set membership, classifier logic and incomplete signatures remain byte-identical', () => {
  const source = fixture(true);
  for (const unknown of [
    source.replace('path:"apps/byo"', 'path:"apps/connect"'),
    source.replace('"assistant-connection"', '"unreviewed-feature"'),
    source.replace('!Primary.has', 'Primary.has'),
    source.replace('var Legacy=new Set', 'var Legacy=new WeakSet'),
    source + ';var Extra=new Set(["browse","connections","app"]);',
    'var label="byo";new Set(["browse","connections","app"]);',
  ]) {
    assert.deepEqual(patchByoAppSidebar(unknown), { code: unknown, patched: false, replacements: 0 });
  }
});
