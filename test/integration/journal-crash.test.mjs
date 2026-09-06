import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempServer, runTool, treeInventory, assertInventoryUnchanged } from "../helpers/copy-fixture.mjs";
import { recoverUnfinishedJournal } from "../../tools/lib/journal.mjs";
import { findServerPackage, workPaths } from "../../tools/lib/paths.mjs";

const crashPoints = [
  ["apply", "snapshot-write#2"], ["apply", "write-baseline:index.html"],
  ["apply", "write-live:assets/app.js"], ["apply", "write-overlay"],
  ["apply", "write-manifest"], ["apply", "remove-staging-file"],
  ["revert", "write-live:assets/app.js"], ["revert", "remove:overlay"],
  ["revert", "remove-work-file#2"], ["revert", "remove-work-directory"],
];

for (const [action, point] of crashPoints) {
  test(`process exit after ${action}/${point}: read-only diagnosis and exact recovery`, async (t) => {
    const root = makeTempServer({ label: "crash", t });
    const server = findServerPackage({ serverDir: root });
    const work = workPaths(server);
    if (action === "revert") assert.equal((await runTool(["apply", "--json", "--server-dir", root])).code, 0);
    const before = treeInventory(server.uiDist);
    const interrupted = await runTool([action, "--json", "--server-dir", root], {
      env: { ...process.env, PAPERCLIP_RU_FAILPOINT: `crash:after:${point}` },
    });
    assert.equal(interrupted.code, 86, interrupted.stdout + interrupted.stderr);
    const interruptedInventory = treeInventory(server.uiDist);
    for (const args of [["doctor"], ["status"], ["verify"], [action, "--dry-run"]]) {
      const diagnosis = await runTool([...args, "--json", "--server-dir", root]);
      assert.equal(diagnosis.code, 5, diagnosis.stdout);
      assert.equal(JSON.parse(diagnosis.stdout).changed, false);
      assertInventoryUnchanged(interruptedInventory, server.uiDist);
    }
    const recovered = recoverUnfinishedJournal({ server, work });
    assert.equal(recovered.recovered, true, JSON.stringify(recovered));
    assertInventoryUnchanged(before, server.uiDist);
    const repeat = await runTool([action, "--json", "--server-dir", root]);
    assert.equal(repeat.code, 0, repeat.stdout + repeat.stderr);
  });
}

test("external live edit after crash blocks recovery before any write", async (t) => {
  const root = makeTempServer({ label: "crash-external", t });
  const server = findServerPackage({ serverDir: root });
  const work = workPaths(server);
  assert.equal((await runTool(["apply", "--json", "--server-dir", root], {
    env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "crash:after:write-overlay" },
  })).code, 86);
  fs.appendFileSync(path.join(server.uiDist, "assets", "app.js"), "\n/* external edit */");
  const before = treeInventory(server.uiDist);
  const recovered = recoverUnfinishedJournal({ server, work });
  assert.equal(recovered.blocked, true);
  assert.match(recovered.reason, /external change/);
  assertInventoryUnchanged(before, server.uiDist);
});

for (const action of ["apply", "revert"]) {
  test(`committed ${action} resumes interrupted evidence cleanup`, async (t) => {
    const root = makeTempServer({ label: "crash-cleanup", t });
    if (action === "revert") assert.equal((await runTool(["apply", "--json", "--server-dir", root])).code, 0);
    assert.equal((await runTool([action, "--json", "--server-dir", root], {
      env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "crash:after:remove-recovery-file" },
    })).code, 86);
    const repeat = await runTool([action, "--json", "--server-dir", root]);
    assert.equal(repeat.code, 0, repeat.stdout + repeat.stderr);
    assert.equal(fs.existsSync(path.join(root, "ui-dist", ".paperclip-ru", "journal.json")), false);
  });
}
