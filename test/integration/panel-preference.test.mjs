import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempServer, runTool, treeInventory, assertInventoryUnchanged } from '../helpers/copy-fixture.mjs';

test('apply/reapply preserve an enabled panel resize preference unless explicitly disabled', async (t) => {
  const server=makeTempServer({label:'panel-preference',t});
  const ui=path.join(server,'ui-dist');
  const manifest=()=>JSON.parse(fs.readFileSync(path.join(ui,'.paperclip-ru','manifest.json'),'utf8'));
  const command=async (args)=>{
    const result=await runTool([...args,'--json','--server-dir',server]);
    assert.equal(result.code,0,result.stderr+result.stdout);
    const output=JSON.parse(result.stdout);
    assert.equal(output.ok,true);
    return output;
  };
  await command(['apply']);
  assert.deepEqual(manifest().features,['translation'],'Clean installation remains opt-in');
  await command(['apply','--with-panel-resize']);
  assert.deepEqual(manifest().features,['translation','panel-resize']);
  for(const action of ['apply','reapply']) {
    const before=treeInventory(ui);
    const dry=await command([action,'--dry-run']);
    assert.equal(dry.changed,false);
    assert.equal(dry.details.panelResize,true,'Dry-run must show the inherited enabled preference');
    assertInventoryUnchanged(before,ui);
    const applied=await command([action]);
    assert.equal(applied.changed,false,'An unchanged enabled installation must be idempotent');
    assert.equal(applied.details.panelResize,true);
    assert.deepEqual(manifest().features,['translation','panel-resize']);
    assertInventoryUnchanged(before,ui);
  }
  const stale=manifest();
  stale.toolVersion='0.9.0';
  fs.writeFileSync(path.join(ui,'.paperclip-ru','manifest.json'),JSON.stringify(stale));
  const upgraded=await command(['reapply']);
  assert.equal(upgraded.details.panelResize,true,'Stale manifests keep the same explicit feature choice');
  assert.deepEqual(manifest().features,['translation','panel-resize']);
  const disabled=await command(['reapply','--without-panel-resize']);
  assert.equal(disabled.details.panelResize,false);
  assert.deepEqual(manifest().features,['translation']);
  assert.ok(!fs.readFileSync(path.join(ui,'assets','paperclip-ru-overlay.js'),'utf8').includes('__paperclipRuPanels'));
  const beforeConflict=treeInventory(ui);
  const conflict=await runTool(['apply','--with-panel-resize','--without-panel-resize','--json','--server-dir',server]);
  assert.equal(conflict.code,2,'Conflicting choices must fail before writing');
  assertInventoryUnchanged(beforeConflict,ui);
  await command(['revert']);
});
