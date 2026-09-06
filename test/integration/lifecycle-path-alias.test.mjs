import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestRoot, makeTempServer } from "../helpers/copy-fixture.mjs";
import { createLifecycleTransaction, lifecycleJournalPath, readLifecycleJournal, recoverLifecycle, rollbackLifecycle } from "../../tools/lib/lifecycle-transaction.mjs";
import { sha256 } from "../../tools/lib/fs-atomic.mjs";

const windowsOnly = { skip: process.platform !== "win32" ? "Windows case-insensitive paths" : false };

test("Windows path aliases share one lifecycle reservation", windowsOnly, (t) => {
  const root = createTestRoot("case-reservation", t);
  const installDir = path.join(root, "ToolCase");
  const alias = installDir.toUpperCase();
  const serverDir = makeTempServer({ label: "case-server", t });
  const transactions = [];
  t.after(() => { for (const tx of transactions) if (fs.existsSync(tx.file)) rollbackLifecycle(tx); });
  const create = (dir) => {
    const tx = createLifecycleTransaction({ action: "install", installDir: dir, serverDir, preState: null, sourceInventory: {} });
    transactions.push(tx);
    return tx;
  };
  const first = create(installDir);
  assert.throws(() => create(alias), /unfinished|owns|EEXIST/);
  assert.equal(lifecycleJournalPath(alias), first.file);
  assert.equal(readLifecycleJournal(alias).id, first.journal.id);
  assert.equal(recoverLifecycle(alias, { dryRun: true }).blocked, true);
  assert.equal(recoverLifecycle(alias).recovered, true);
});

test("Windows aliases find a pending journal from the previous case-sensitive naming scheme", windowsOnly, (t) => {
  const root = createTestRoot("legacy-case-journal", t);
  const installDir = path.join(root, "ToolCase");
  const alias = installDir.toUpperCase();
  const serverDir = makeTempServer({ label: "legacy-case-server", t });
  const tx = createLifecycleTransaction({ action: "install", installDir, serverDir, preState: null, sourceInventory: {} });
  const legacyFile = path.join(os.tmpdir(), `paperclip-ru-lifecycle-${sha256(Buffer.from(path.resolve(installDir))).slice(0, 24)}.json`);
  if (tx.file !== legacyFile) fs.renameSync(tx.file, legacyFile);
  const legacy = { ...tx.journal, recoveryDir: `${legacyFile}.recovery` };
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  t.after(() => { if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile); });
  assert.equal(lifecycleJournalPath(alias), legacyFile);
  assert.equal(readLifecycleJournal(alias).id, legacy.id);
  assert.equal(recoverLifecycle(alias).recovered, true);
  assert.equal(fs.existsSync(legacyFile), false);
});
