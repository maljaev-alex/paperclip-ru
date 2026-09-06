import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempServer, createTestRoot, runTool, treeInventory, assertInventoryUnchanged } from "../helpers/copy-fixture.mjs";

test("help and version flags never execute the selected command", async (t) => {
  const server = makeTempServer({ label: "help-read-only", t });
  const root = createTestRoot("help-output", t);
  const ui = path.join(server, "ui-dist");
  const before = treeInventory(ui);
  const outputBefore = treeInventory(root);
  for (const command of ["doctor", "status", "verify", "apply", "reapply", "revert", "extract", "report", "install", "update", "uninstall"]) {
    for (const flag of ["--help", "-h", "--version"]) {
      const args = [command, flag, "--json", "--server-dir", server];
      if (["install", "update", "uninstall"].includes(command)) args.push("--install-dir", path.join(root, "tool"));
      if (["install", "update"].includes(command)) args.push("--source-dir", path.join(root, "missing-offline-source"));
      if (["extract", "report"].includes(command)) args.push("--output", path.join(root, "report.json"));
      const result = await runTool(args);
      assert.equal(result.code, 0, `${command} ${flag}: ${result.stdout}${result.stderr}`);
      const out = JSON.parse(result.stdout);
      assert.equal(out.action, flag === "--version" ? "version" : "help", result.stdout);
      assert.equal(out.changed, false, result.stdout);
      assert.equal(out.error, null);
      assertInventoryUnchanged(before, ui);
      assertInventoryUnchanged(outputBefore, root);
    }
  }
  // Also prove that revert --help preserves an applied installation.
  assert.equal((await runTool(["apply", "--json", "--server-dir", server])).code, 0);
  const applied = treeInventory(ui);
  const result = await runTool(["revert", "--help", "--json", "--server-dir", server]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).action, "help");
  assertInventoryUnchanged(applied, ui);
  assert.equal(fs.existsSync(path.join(ui, ".paperclip-ru", "manifest.json")), true);
});
