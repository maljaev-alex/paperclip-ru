import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTestRoot, makeTempServer, runTool, treeInventory, assertInventoryUnchanged } from "../helpers/copy-fixture.mjs";
import { buildRelease } from "../../tools/lib/release-builder.mjs";
import { makeReleaseVariant, NEXT_TOOL_VERSION } from "../helpers/release-variant.mjs";
import { readOwnershipMarker, writeOwnershipMarker, lifecycleJournalPath, recoverInterruptedLifecycle } from "../../tools/lib/lifecycle.mjs";
import { TOOL_VERSION } from "../../tools/lib/constants.mjs";

let releases;
function releasePair() {
  if (releases) return releases;
  const root = createTestRoot("cross-version");
  const base = path.join(root, "base");
  buildRelease({ testBuild: true, outDir: base });
  releases = { base, next: makeReleaseVariant(base, path.join(root, "next")) };
  return releases;
}

for (const state of ["applied/current", "installed_not_applied", "applied/stale"]) {
  for (const point of ["after:rename-install-to-prev", "after:cli:apply"]) {
    test(`real update process crash ${point} restores ${state}`, async (t) => {
      const fx = await installed(t, state);
      const beforeTool = treeInventory(fx.installDir);
      const beforeUi = treeInventory(fx.ui);
      const res = await runTool(updateArgs(fx), { tool: fx.tool, env: { ...process.env, PAPERCLIP_RU_FAILPOINT: `crash:${point}` } });
      assert.equal(res.code, 86, res.stdout + res.stderr);
      assert.equal(recoverInterruptedLifecycle(fx.installDir, { dryRun: true }).blocked, true);
      const recovered = recoverInterruptedLifecycle(fx.installDir);
      assert.equal(recovered.recovered, true, JSON.stringify(recovered));
      assertInventoryUnchanged(beforeTool, fx.installDir);
      assertInventoryUnchanged(beforeUi, fx.ui);
      assert.equal(parsed(await runTool(["status", "--json", "--server-dir", fx.server], { tool: fx.tool })).stateAfter, state);
    });
  }
}

for (const point of ["after:uninstall-remove", "after:uninstall-owned-remove#3"]) {
  test(`real uninstall crash ${point} restores exact tool and UI`, async (t) => {
    const fx = await installed(t);
    const beforeTool = treeInventory(fx.installDir);
    const beforeUi = treeInventory(fx.ui);
    const res = await runTool(["uninstall", "--json", "--install-dir", fx.installDir, "--server-dir", fx.server], {
      tool: fx.tool, env: { ...process.env, PAPERCLIP_RU_FAILPOINT: `crash:${point}` },
    });
    assert.equal(res.code, 86, res.stdout + res.stderr);
    const recovered = recoverInterruptedLifecycle(fx.installDir);
    assert.equal(recovered.recovered, true, JSON.stringify(recovered));
    assertInventoryUnchanged(beforeTool, fx.installDir);
    assertInventoryUnchanged(beforeUi, fx.ui);
    assert.equal(fs.existsSync(`${fx.installDir}.deleting`), false);
  });
}

for (const target of ['tool-extra', 'tool-edit', 'ui-extra', 'ui-edit', 'ui-work-extra']) {
  test(`external ${target} after lifecycle crash blocks recovery without writes`, async (t) => {
    const fx = await installed(t);
    const crash = await runTool(updateArgs(fx), { tool: fx.tool, env: { ...process.env, PAPERCLIP_RU_FAILPOINT: 'crash:after:cli:apply' } });
    assert.equal(crash.code, 86, crash.stdout);
    const root = target.startsWith('tool') ? fx.installDir : fx.ui;
    const relative = target === 'tool-edit' ? 'README.md' : target === 'ui-edit' ? 'index.html' : target === 'ui-work-extra' ? '.paperclip-ru/foreign-note.txt' : 'foreign-note.txt';
    fs.writeFileSync(path.join(root, relative), 'External changes must survive.');
    const beforeTool = treeInventory(fx.installDir), beforeUi = treeInventory(fx.ui);
    const recovery = recoverInterruptedLifecycle(fx.installDir);
    assert.equal(recovery.blocked, true, JSON.stringify(recovery));
    assertInventoryUnchanged(beforeTool, fx.installDir);
    assertInventoryUnchanged(beforeUi, fx.ui);
  });
}

test('child process exits during apply: parent restores both trees', async (t) => {
  const fx = await installed(t, 'installed_not_applied');
  const beforeTool = treeInventory(fx.installDir), beforeUi = treeInventory(fx.ui);
  const result = await runTool(updateArgs(fx), { tool: fx.tool, env: { ...process.env, PAPERCLIP_RU_FAILPOINT: 'crash:after:write-live:index.html' } });
  assert.notEqual(result.code, 0);
  assert.equal(parsed(result).details?.rollbackOk, true, result.stdout);
  assertInventoryUnchanged(beforeTool, fx.installDir);
  assertInventoryUnchanged(beforeUi, fx.ui);
});

test('first install creates missing parents and restores their absence on failure', async (t) => {
  const root = createTestRoot('new-parents', t);
  const server = makeTempServer({ label: 'parent-server', t });
  const dest = path.join(root, 'nested', 'share', 'tool');
  const args = ['install', '--json', '--source-dir', releasePair().base, '--install-dir', dest, '--server-dir', server];
  const failed = await runTool(args, { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: 'after:rename-stage-to-install' } });
  assert.equal(parsed(failed).details?.rollbackOk, true, failed.stdout);
  assert.equal(fs.existsSync(path.join(root, 'nested')), false);
  const installed = await runTool(args);
  assert.equal(installed.code, 0, installed.stdout);
});

for (const failpoint of [null, 'after:cli:apply']) {
  test(`replacement supports a build the previous CLI rejects: ${failpoint || 'success'}`, async (t) => {
    const fx = await installed(t, 'installed_not_applied');
    const file = path.join(fx.installDir, 'data/compatibility.json');
    const compat = JSON.parse(fs.readFileSync(file, 'utf8'));
    compat.releases = compat.releases.filter(r => !r.synthetic);
    fs.writeFileSync(file, JSON.stringify(compat));
    writeOwnershipMarker(fx.installDir);
    const beforeTool = treeInventory(fx.installDir), beforeUi = treeInventory(fx.ui);
    const status = await runTool(['status', '--json', '--server-dir', fx.server], { tool: fx.tool });
    assert.equal(status.code, 4, status.stdout);
    const result = await runTool(updateArgs(fx), { tool: fx.tool, env: { ...process.env, ...(failpoint ? { PAPERCLIP_RU_FAILPOINT: failpoint } : {}) } });
    if (failpoint) {
      assert.equal(parsed(result).details?.rollbackOk, true, result.stdout);
      assertInventoryUnchanged(beforeTool, fx.installDir);
      assertInventoryUnchanged(beforeUi, fx.ui);
    } else assert.equal(result.code, 0, result.stdout);
  });
}

test("failed previous CLI verification retains recovery evidence for retry", async (t) => {
  const fx = await installed(t);
  const beforeTool = treeInventory(fx.installDir);
  const beforeUi = treeInventory(fx.ui);
  const res = await runTool(updateArgs(fx), { tool: fx.tool, env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "after:cli:apply,previous-tool-verify" } });
  assert.notEqual(res.code, 0);
  assert.equal(parsed(res).details.rollbackOk, false);
  assert.equal(parsed(res).baselineSafe, false);
  assert.equal(fs.existsSync(lifecycleJournalPath(fx.installDir)), true);
  const recovered = recoverInterruptedLifecycle(fx.installDir);
  assert.equal(recovered.recovered, true, JSON.stringify(recovered));
  assertInventoryUnchanged(beforeTool, fx.installDir);
  assertInventoryUnchanged(beforeUi, fx.ui);
});

for (const state of ["applied/current", "installed_not_applied"]) {
  test(`uninstall rejects actual child exits 1/3/4/5/6 in ${state}`, async (t) => {
    const fx = await installed(t, state);
    const original = fs.readFileSync(fx.tool, "utf8");
    fs.writeFileSync(fx.tool, original.replace(/^#![^\n]*\n/, "") + `
// The installed fixture CLI reports an independent verification failure.
`);
    const prefix = `if (process.argv[2] === "verify" && process.env.TEST_VERIFY_EXIT) {
      console.log(JSON.stringify({ok:false,action:"verify",changed:false,baselineSafe:null,error:"injected child failure"}));
      process.exit(Number(process.env.TEST_VERIFY_EXIT));
    }\n`;
    fs.writeFileSync(fx.tool, prefix + fs.readFileSync(fx.tool, "utf8"));
    writeOwnershipMarker(fx.installDir);
    const beforeTool = treeInventory(fx.installDir);
    const beforeUi = treeInventory(fx.ui);
    for (const code of [1, 3, 4, 5, 6]) {
      const res = await runTool(["uninstall", "--json", "--install-dir", fx.installDir, "--server-dir", fx.server], {
        tool: fx.tool, env: { ...process.env, TEST_VERIFY_EXIT: String(code) },
      });
      assert.equal(res.code, code, res.stdout);
      assert.equal(parsed(res).ok, false);
      assert.equal(parsed(res).changed, false);
      assert.equal(parsed(res).baselineSafe, null);
      assertInventoryUnchanged(beforeTool, fx.installDir);
      assertInventoryUnchanged(beforeUi, fx.ui);
      assert.equal(fs.existsSync(lifecycleJournalPath(fx.installDir)), false);
    }
  });
}
function parsed(res) { return JSON.parse(res.stdout.trim()); }
async function installed(t, state = "applied/current") {
  const root = createTestRoot("rollback", t);
  const server = makeTempServer({ t });
  const installDir = path.join(root, "installed");
  const result = await runTool(["install", "--json", "--source-dir", releasePair().base, "--install-dir", installDir, "--server-dir", server]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const tool = path.join(installDir, "tools/paperclip-ru.mjs");
  if (state === "installed_not_applied") {
    const revert = await runTool(["revert", "--json", "--server-dir", server], { tool });
    assert.equal(revert.code, 0, revert.stdout);
  } else if (state === "applied/stale") {
    const file = path.join(server, "ui-dist/.paperclip-ru/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.toolVersion = "0.9.0";
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
  return { root, installDir, tool, server, ui: path.join(server, "ui-dist") };
}
function updateArgs(fx, asset = `paperclip-ru-${NEXT_TOOL_VERSION}.zip`) {
  return ["update", "--json", "--release-version", NEXT_TOOL_VERSION, "--source-dir", releasePair().next, "--asset", asset, "--install-dir", fx.installDir, "--server-dir", fx.server];
}

for (const asset of [`paperclip-ru-${NEXT_TOOL_VERSION}.zip`, `paperclip-ru-${NEXT_TOOL_VERSION}.tar.gz`]) {
  test(`old installed CLI updates to a different tool version from ${asset}`, async (t) => {
    const fx = await installed(t);
    const result = await runTool(updateArgs(fx, asset), { tool: fx.tool });
    const doc = parsed(result);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(doc.toolVersion, NEXT_TOOL_VERSION);
    assert.equal(doc.installedVersion, TOOL_VERSION);
    assert.equal(doc.selectedVersion, NEXT_TOOL_VERSION);
    assert.equal(readOwnershipMarker(fx.installDir).toolVersion, NEXT_TOOL_VERSION);
    const verify = await runTool(["verify", "--json", "--server-dir", fx.server], { tool: fx.tool });
    assert.equal(verify.code, 0, verify.stdout);
    assert.equal(parsed(verify).toolVersion, NEXT_TOOL_VERSION);
  });
}

for (const state of ["applied/current", "installed_not_applied", "applied/stale"]) {
  for (const point of ["after:rename-install-to-prev", "after:rename-stage-to-install", "after:cli:apply", "cli:verify#2", "remove-prev", "after:remove-prev"]) {
    test(`cross-version ${point} restores exact ${state} and old tool`, async (t) => {
      const fx = await installed(t, state);
      const beforeTool = treeInventory(fx.installDir);
      const beforeUi = treeInventory(fx.ui);
      const result = await runTool(updateArgs(fx), { tool: fx.tool, env: { ...process.env, PAPERCLIP_RU_FAILPOINT: point } });
      assert.notEqual(result.code, 0, result.stdout);
      assert.equal(parsed(result).ok, false);
      assert.equal(parsed(result).details?.rollbackOk, true, result.stdout);
      assertInventoryUnchanged(beforeTool, fx.installDir);
      assertInventoryUnchanged(beforeUi, fx.ui);
      assert.equal(fs.existsSync(`${fx.installDir}.prev`), false);
      assert.equal(fs.existsSync(`${fx.installDir}.staging`), false);
      assert.equal(fs.existsSync(lifecycleJournalPath(fx.installDir)), false);
      const status = await runTool(["status", "--json", "--server-dir", fx.server], { tool: fx.tool });
      assert.equal(parsed(status).stateAfter, state);
      assert.equal(parsed(status).toolVersion, TOOL_VERSION);
    });
  }
}
