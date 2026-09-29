import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { treeInventory } from '../../tools/lib/tree-snapshot.mjs';
import { restoreOfficialUi } from '../../tools/lib/official-gate-cleanup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-gate-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uiDist = path.join(root, 'ui-dist');
  fs.mkdirSync(uiDist);
  fs.writeFileSync(path.join(uiDist, 'index.html'), 'original');
  return { uiDist, output: root, before: treeInventory(uiDist) };
}

test('an untouched unsupported bundle preserves the original gate error', async t => {
  const options = fixture(t);
  const original = new Error('doctor failed: unsupported');
  await assert.rejects(async () => {
    try { throw original; }
    finally {
      await restoreOfficialUi({ ...options, revert: async () => { throw new Error('revert must not run'); } });
    }
  }, error => error === original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.output, 'revert-inventory.json'))), { ok: true });
});

test('a changed bundle still requires a byte-identical revert', async t => {
  const options = fixture(t);
  const file = path.join(options.uiDist, 'index.html');
  fs.writeFileSync(file, 'patched');
  let called = false;
  await restoreOfficialUi({ ...options, revert: async () => {
    called = true;
    fs.writeFileSync(file, 'original');
  } });
  assert.equal(called, true);
});

test('a failed or incomplete revert cannot pass cleanup', async t => {
  const options = fixture(t);
  fs.writeFileSync(path.join(options.uiDist, 'index.html'), 'patched');
  await assert.rejects(restoreOfficialUi({ ...options, revert: async () => { throw new Error('conflict'); } }), /conflict/);
  await assert.rejects(restoreOfficialUi({ ...options, revert: async () => {} }), /differs from the original inventory/);
});
