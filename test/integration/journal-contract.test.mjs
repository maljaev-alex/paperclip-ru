import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempServer, runTool, treeInventory, assertInventoryUnchanged } from "../helpers/copy-fixture.mjs";
import { recoverUnfinishedJournal } from "../../tools/lib/journal.mjs";
import { findServerPackage, workPaths } from "../../tools/lib/paths.mjs";

const invoke = (root, action, failpoint, flags = []) => runTool([action, "--json", "--server-dir", root, ...flags], {
  env: { ...process.env, PAPERCLIP_RU_FAILPOINT: failpoint || "" },
});

for (const action of ["apply", "revert"]) {
  for (const doubleFailure of [false, true]) {
    test(`${action} JSON describes ${doubleFailure ? "unproven" : "successful"} rollback`, async (t) => {
      const root = makeTempServer({ label: "rollback-contract", t });
      if (action === "revert") assert.equal((await invoke(root, "apply")).code, 0);
      const ui = path.join(root, "ui-dist");
      const before = treeInventory(ui);
      const state = action === "apply" ? "installed_not_applied" : "applied/current";
      const failed = await invoke(root, action, `after:write-live:index.html${doubleFailure ? ",rollback-write" : ""}`);
      assert.equal(failed.code, 1, failed.stdout + failed.stderr);
      const out = JSON.parse(failed.stdout);
      assert.equal(out.action, action);
      assert.equal(out.details.rollbackOk, !doubleFailure);
      assert.equal(out.changed, doubleFailure, failed.stdout);
      assert.equal(out.stateBefore, state, failed.stdout);
      assert.equal(out.stateAfter, doubleFailure ? "conflict/partial" : state, failed.stdout);
      assert.equal(out.baselineSafe, !doubleFailure);
      assert.equal(out.nextAction, doubleFailure ? "force_manual" : "none");
      if (doubleFailure) {
        assert.notEqual(treeInventory(ui)["index.html"].hash, before["index.html"].hash);
        const server = findServerPackage({ serverDir: root });
        assert.equal(recoverUnfinishedJournal({ server, work: workPaths(server) }).recovered, true);
      }
      assertInventoryUnchanged(before, ui);
    });
  }
}

test("revert reports the stale pre-state in dry-run, rollback and success", async (t) => {
  const root = makeTempServer({ label: "stale-revert-contract", t });
  assert.equal((await invoke(root, "apply")).code, 0);
  const file = path.join(root, "ui-dist", ".paperclip-ru", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.toolVersion = "0.9.0";
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(JSON.parse((await invoke(root, "status")).stdout).stateAfter, "applied/stale");
  for (const [point, flags, code, after] of [[null, ["--dry-run"], 0, "applied/stale"], ["after:remove:overlay", [], 1, "applied/stale"], [null, [], 0, "installed_not_applied"]]) {
    const result = await invoke(root, "revert", point, flags);
    assert.equal(result.code, code, result.stdout);
    const out = JSON.parse(result.stdout);
    assert.equal(out.stateBefore, "applied/stale", result.stdout);
    assert.equal(out.stateAfter, after, result.stdout);
  }
});

const posixOnly = { skip: process.platform === "win32" ? "POSIX permission bits" : false };
test("recovery and staging copies do not broaden access to private originals", posixOnly, async (t) => {
  const root = makeTempServer({ label: "private-snapshots", t });
  const server = findServerPackage({ serverDir: root });
  const work = workPaths(server);
  fs.chmodSync(path.join(server.uiDist, "assets", "app.js"), 0o600);
  const before = treeInventory(server.uiDist);
  assert.equal((await invoke(root, "apply", "crash:after:write-baseline:assets/app.js")).code, 86);
  for (const rel of ["recovery/live/assets/app.js", "staging/assets/app.js", "baseline/assets/app.js"]) {
    assert.equal(fs.statSync(path.join(work.root, rel)).mode & 0o777, 0o600, rel);
  }
  assert.equal(recoverUnfinishedJournal({ server, work }).recovered, true);
  assertInventoryUnchanged(before, server.uiDist);
});

for (const point of ["remove:overlay", "remove-workdir"]) {
  for (const crash of [false, true]) {
    test(`revert ${crash ? "crash" : "failure"} after ${point} restores restricted modes`, posixOnly, async (t) => {
      const root = makeTempServer({ label: "rollback-permissions", t });
      assert.equal((await invoke(root, "apply")).code, 0);
      const server = findServerPackage({ serverDir: root });
      const work = workPaths(server);
      const protectedPaths = new Map([
        ["assets/paperclip-ru-overlay.js", 0o600],
        [".paperclip-ru/baseline/assets/app.js", 0o640],
        [".paperclip-ru/baseline/assets", 0o700],
        [".paperclip-ru/baseline", 0o750],
        [".paperclip-ru", 0o700],
      ]);
      for (const [rel, mode] of protectedPaths) fs.chmodSync(path.join(server.uiDist, rel), mode);
      const before = treeInventory(server.uiDist);
      const result = await invoke(root, "revert", `${crash ? "crash:" : ""}after:${point}`);
      assert.equal(result.code, crash ? 86 : 1, result.stdout + result.stderr);
      if (crash) {
        const recovery = recoverUnfinishedJournal({ server, work });
        assert.equal(recovery.recovered, true, JSON.stringify(recovery));
      } else assert.equal(JSON.parse(result.stdout).details.rollbackOk, true, result.stdout);
      for (const [rel, mode] of protectedPaths) assert.equal(fs.statSync(path.join(server.uiDist, rel)).mode & 0o777, mode, rel);
      assertInventoryUnchanged(before, server.uiDist);
    });
  }
}

test("recovery without original POSIX modes refuses to guess permissions", posixOnly, async (t) => {
  const root = makeTempServer({ label: "legacy-journal-modes", t });
  assert.equal((await invoke(root, "apply")).code, 0);
  assert.equal((await invoke(root, "revert", "crash:after:remove:overlay")).code, 86);
  const server = findServerPackage({ serverDir: root });
  const work = workPaths(server);
  const journal = JSON.parse(fs.readFileSync(work.journal, "utf8"));
  delete journal.oldModes;
  for (const inventory of [journal.workInventoryBefore, journal.workInventoryDirsBefore, journal.liveInventoryBefore.files, journal.liveInventoryBefore.dirs]) {
    for (const rec of Object.values(inventory)) delete rec.mode;
  }
  fs.writeFileSync(work.journal, JSON.stringify(journal));
  const before = treeInventory(server.uiDist);
  const recovery = recoverUnfinishedJournal({ server, work });
  assert.equal(recovery.blocked, true);
  assert.match(recovery.reason, /mode|permission/);
  assertInventoryUnchanged(before, server.uiDist);
});

for (const rel of ["assets/app.js", ".paperclip-ru/baseline/assets/app.js"]) {
  test(`external chmod after crash blocks recovery: ${rel}`, posixOnly, async (t) => {
    const root = makeTempServer({ label: "external-permissions", t });
    assert.equal((await invoke(root, "apply")).code, 0);
    const server = findServerPackage({ serverDir: root });
    const target = path.join(server.uiDist, rel);
    fs.chmodSync(target, 0o640);
    assert.equal((await invoke(root, "revert", "crash:after:remove:overlay")).code, 86);
    fs.chmodSync(target, 0o600);
    const before = treeInventory(server.uiDist);
    const recovery = recoverUnfinishedJournal({ server, work: workPaths(server) });
    assert.equal(recovery.blocked, true);
    assert.match(recovery.reason, /mode|permission/);
    assertInventoryUnchanged(before, server.uiDist);
  });
}
