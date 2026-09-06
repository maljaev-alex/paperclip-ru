import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempServer, runTool, treeInventory, assertInventoryUnchanged } from '../helpers/copy-fixture.mjs';

const manifestOf = (ui) => JSON.parse(fs.readFileSync(path.join(ui, '.paperclip-ru', 'manifest.json'), 'utf8'));

async function command(server, args) {
  const result = await runTool([...args, '--json', '--server-dir', server]);
  const output = result.stdout.trim() ? JSON.parse(result.stdout) : null;
  return { ...result, output };
}

test('idempotent apply reports the same overlay hash fields as a writing apply', async (t) => {
  const server = makeTempServer({ label: 'overlay-hash-parity', t });
  const first = await command(server, ['apply', '--with-panel-resize']);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  assert.match(String(first.output.details.overlayHash), /^[a-f0-9]{64}$/, 'a writing apply must expose the overlay hash');

  const idempotent = await command(server, ['apply']);
  assert.equal(idempotent.code, 0, idempotent.stderr + idempotent.stdout);
  assert.equal(idempotent.output.details.idempotent, true);
  assert.equal(idempotent.output.details.overlayHash, first.output.details.overlayHash,
    'the already-current result must carry the overlay hash too, so a plan can be diffed across states');
  assert.equal(idempotent.output.details.overlayStamp, idempotent.output.details.overlayHash.slice(0, 10));
  assert.equal(idempotent.output.details.overlayHash, manifestOf(path.join(server, 'ui-dist')).overlayHash);
});

test('undeclared files inside the owned root are reported by verify and pruned by reapply', async (t) => {
  const server = makeTempServer({ label: 'undeclared-owned', t });
  const ui = path.join(server, 'ui-dist');
  assert.equal((await command(server, ['apply'])).code, 0);

  // An older revision saved a baseline for every inspected target, not only the
  // owned ones. Simulate that residue and require it to be surfaced.
  const baseline = path.join(ui, '.paperclip-ru', 'baseline');
  const stale = path.join(baseline, 'assets', 'stale-from-old-version.js');
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, 'console.log("left over by an older tool revision");\n');

  const verified = await command(server, ['verify']);
  assert.equal(verified.code, 0, 'stale metadata is a warning, not a conflict');
  assert.equal(verified.output.ok, true);
  assert.deepEqual(verified.output.verification.undeclaredOwnedPaths,
    ['.paperclip-ru/baseline/assets/stale-from-old-version.js']);
  assert.ok(verified.output.warnings.some((w) => w.includes('.paperclip-ru')), 'verify must mention the undeclared files');

  const reapplied = await command(server, ['reapply']);
  assert.equal(reapplied.code, 0, reapplied.stderr + reapplied.stdout);
  assert.equal(fs.existsSync(stale), false, 'reapply must prune baseline files the manifest does not declare');
  assert.ok(reapplied.output.warnings.some((w) => /Удалены неучтённые файлы/.test(w)), 'the prune must be reported');
  assert.equal(reapplied.output.changed, true, 'pruning owned bytes is a real change, not an idempotent run');

  const after = await command(server, ['verify']);
  assert.deepEqual(after.output.verification.undeclaredOwnedPaths, []);

  const declared = manifestOf(ui).ownedPaths.filter((p) => p.startsWith('.paperclip-ru/baseline/'));
  assert.equal(Object.keys(treeInventory(baseline)).length, declared.length,
    'the baseline directory must hold exactly the declared files');

  const revert = await command(server, ['revert']);
  assert.equal(revert.code, 0);
  assert.equal(revert.output.verification.byteIdentical, true);
});

test('an undeclared file outside baseline/ is pruned too, so the idempotent shortcut is not blocked forever', async (t) => {
  const server = makeTempServer({ label: 'undeclared-stray', t });
  const ui = path.join(server, 'ui-dist');
  assert.equal((await command(server, ['apply'])).code, 0);

  const stray = path.join(ui, '.paperclip-ru', 'leftover-from-old-revision.json');
  fs.writeFileSync(stray, '{"schema":"paperclip-ru-manifest/v2"}\n');
  assert.deepEqual((await command(server, ['verify'])).output.verification.undeclaredOwnedPaths,
    ['.paperclip-ru/leftover-from-old-revision.json']);

  const reapplied = await command(server, ['reapply']);
  assert.equal(reapplied.code, 0, reapplied.stderr + reapplied.stdout);
  assert.equal(fs.existsSync(stray), false, 'a stray file anywhere in the owned root must be pruned');

  // Once the root is clean the shortcut must come back, otherwise every future
  // apply would rewrite the bundle and idempotence would be lost.
  const inventory = treeInventory(ui);
  const again = await command(server, ['apply']);
  assert.equal(again.output.details.idempotent, true, 'a clean owned root must take the idempotent path again');
  assert.equal(again.output.changed, false);
  assertInventoryUnchanged(inventory, ui);
});

test('a failure that is turned into a result still writes a diagnostic line to stderr', async (t) => {
  const server = makeTempServer({ label: 'stderr-diagnostic', t });
  const ui = path.join(server, 'ui-dist');
  const before = treeInventory(ui);
  const missing = path.join(server, 'no-such-server');

  const human = await runTool(['status', '--server-dir', missing]);
  assert.equal(human.code, 3, 'a missing Paperclip must stay exit 3');
  assert.ok(human.stderr.trim().length > 0, 'human mode must report the failure on stderr');

  const json = await runTool(['status', '--json', '--server-dir', missing]);
  assert.equal(json.code, 3);
  const doc = JSON.parse(json.stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.stateAfter, 'not_installed');
  assert.equal(doc.verification, null);
  assert.equal(json.stdout.trim().split('\n').length, 1, 'stdout must stay exactly one JSON document');
  assert.doesNotMatch(json.stdout, /^Ошибка:/m, 'the diagnostic must not leak into the JSON channel');

  assertInventoryUnchanged(before, ui);
});
