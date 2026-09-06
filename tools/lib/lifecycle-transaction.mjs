import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteFile, sha256 } from "./fs-atomic.mjs";
import { assertSafeInstallDir } from "./safe-install-path.mjs";
import { captureTree, validateSnapshot, restoreTree, removeTree, treeInventory } from "./tree-snapshot.mjs";
import { hit } from "./failpoints.mjs";
import { inspectJournalRecovery, recoverUnfinishedJournal } from './journal.mjs';
import { workPaths } from './paths.mjs';

const pathKey = (dir) => process.platform === "win32" ? path.resolve(dir).toLowerCase() : path.resolve(dir);
const journalFile = (key, legacy = false) => path.join(os.tmpdir(), `paperclip-ru-lifecycle-${legacy ? "" : "v2-"}${sha256(Buffer.from(key)).slice(0, 24)}.json`);

export function lifecycleJournalPath(installDir) {
  const key = pathKey(installDir);
  const canonical = journalFile(key);
  if (process.platform !== "win32") {
    const legacy = journalFile(key, true);
    if (fs.existsSync(legacy)) {
      if (fs.existsSync(canonical)) throw new Error("lifecycle: multiple journals refer to the same installation; recovery refused");
      return legacy;
    }
    return canonical;
  }
  // Pre-release journals used case-sensitive hashes. Find them even when a retry
  // spells the same Windows path differently; never abandon pending evidence.
  const found = new Set(fs.existsSync(canonical) ? [canonical] : []);
  const exactLegacy = journalFile(path.resolve(installDir), true);
  if (fs.existsSync(exactLegacy)) found.add(exactLegacy);
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!/^paperclip-ru-lifecycle-[a-f0-9]{24}\.json$/.test(name)) continue;
    const file = path.join(os.tmpdir(), name);
    if (found.has(file)) continue;
    try {
      const candidate = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof candidate.installDir === "string" && pathKey(candidate.installDir) === key
        && [journalFile(path.resolve(candidate.installDir), true), journalFile(pathKey(candidate.installDir), true)].includes(file)) found.add(file);
    } catch { /* unrelated, unreadable or already removed journal */ }
  }
  if (found.size > 1) throw new Error("lifecycle: multiple journals refer to the same installation; recovery refused");
  return found.values().next().value || canonical;
}

export function readLifecycleJournal(installDir) {
  const file = lifecycleJournalPath(installDir);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { stage: "corrupt", recovery: "unproven" }; }
}

function persist(file, journal) {
  hit("write-lifecycle-journal");
  atomicWriteFile(file, `${JSON.stringify(journal)}\n`);
  hit("write-lifecycle-journal", { after: true });
}

export function transactionStep(file, journal) {
  return (label, action, relativePath = null) => {
    journal.stage = `before:${label}`;
    journal.operation = { label, path: relativePath };
    persist(file, journal);
    hit(label);
    const value = action();
    journal.stage = `after:${label}`;
    persist(file, journal);
    hit(label, { after: true });
    return value;
  };
}

export function createLifecycleTransaction({ action, installDir, serverDir, preState, sourceInventory, plannedUiHashes = {} }) {
  const file = lifecycleJournalPath(installDir);
  const journal = {
    schema: "paperclip-ru-lifecycle-journal/v2", id: crypto.randomUUID(), action,
    ownerPid: process.pid, stage: "prepared", recovery: "pending", installDir, serverDir,
    recoveryDir: `${file}.recovery`, preState, sourceInventory, plannedUiHashes, snapshots: {}, ready: false,
    siblingPaths: [".staging", ".prev", ".deleting"].map((suffix) => `${installDir}${suffix}`),
    createdParents: [],
  };
  for (let p = path.dirname(installDir); !fs.existsSync(p); p = path.dirname(p)) journal.createdParents.push(p);
  for (const p of [file, journal.recoveryDir, ...journal.siblingPaths]) {
    if (fs.existsSync(p)) throw new Error("lifecycle: unfinished or unowned transaction path");
  }
  const tx = { file, journal, step: transactionStep(file, journal) };
  // Reserve atomically so two commands cannot activate the same installation.
  fs.writeFileSync(file, `${JSON.stringify(journal)}\n`, { flag: "wx", mode: 0o600 });
  return tx;
}

function assertKnownSubset(root, inventories) {
  const actual = treeInventory(root);
  for (const [rel, rec] of Object.entries(actual.files)) {
    if (!inventories.some((inv) => inv?.files?.[rel]?.hash === rec.hash)) throw new Error(`lifecycle: external file at ${rel}; recovery refused`);
  }
  for (const rel of Object.keys(actual.dirs)) {
    if (rel && !inventories.some((inv) => inv?.dirs?.[rel])) throw new Error(`lifecycle: external directory at ${rel}; recovery refused`);
  }
}

function assertRecoveryLive(journal) {
  const old = journal.snapshots.install.inventory;
  const toolStates = [old, journal.sourceInventory, journal.activatedInventory];
  assertKnownSubset(journal.installDir, toolStates);
  assertKnownSubset(`${journal.installDir}.staging`, toolStates);
  assertKnownSubset(`${journal.installDir}.prev`, [old]);
  assertKnownSubset(`${journal.installDir}.deleting`, [old]);
  const before = journal.snapshots.ui.inventory;
  const server = { uiDist: path.join(journal.serverDir, 'ui-dist') };
  const child = inspectJournalRecovery({ server, work: workPaths(server) });
  const current = treeInventory(server.uiDist);
  const allowed = (rel, hash) => before.files[rel]?.hash === hash || journal.plannedUiHashes?.[rel] === hash;
  for (const [rel, rec] of Object.entries(current.files)) {
    if (allowed(rel, rec.hash)) continue;
    if (!rel.startsWith('.paperclip-ru/')) throw new Error(`lifecycle: external UI edit at ${rel}; recovery refused`);
    if (child) continue;
    const owned = rel.slice('.paperclip-ru/'.length);
    const original = owned.replace(/^(baseline|staging)\//, '');
    if (original !== owned && (allowed(original, rec.hash) || before.files[`.paperclip-ru/baseline/${original}`]?.hash === rec.hash)) continue;
    // Metadata created by a completed child is checked against the proven plan.
    if (owned === 'manifest.json') {
      const manifest = JSON.parse(fs.readFileSync(path.join(journal.serverDir, 'ui-dist', rel), 'utf8'));
      if (manifest.schema === 'paperclip-ru-manifest/v3' && Object.entries(manifest.files || {}).every(([p, hashes]) =>
        allowed(p, hashes.patchedHash) && (allowed(p, hashes.baselineHash) || before.files[`.paperclip-ru/baseline/${p}`]?.hash === hashes.baselineHash))) continue;
    }
    throw new Error(`lifecycle: unproven UI recovery file at ${rel}; recovery refused`);
  }
  for (const rel of Object.keys(current.dirs)) {
    if (child && rel.startsWith('.paperclip-ru')) continue;
    if (before.dirs[rel] || rel === '' || rel === '.paperclip-ru' || ['baseline', 'staging'].some((prefix) => rel === `.paperclip-ru/${prefix}` || Object.keys(journal.plannedUiHashes || {}).some((file) => `.paperclip-ru/${prefix}/${file}`.startsWith(`${rel}/`)))) continue;
    throw new Error(`lifecycle: external UI directory at ${rel}; recovery refused`);
  }
}

export function prepareLifecycleSnapshots(tx) {
  const { file, journal, step } = tx;
  persist(file, journal);
  journal.snapshots.install = captureTree(journal.installDir, path.join(journal.recoveryDir, "install"), step);
  persist(file, journal);
  journal.snapshots.ui = captureTree(path.join(journal.serverDir, "ui-dist"), path.join(journal.recoveryDir, "ui"), step);
  journal.ready = true;
  journal.stage = "snapshots-ready";
  persist(file, journal);
}

function validateJournal(installDir, file, journal) {
  if (journal?.schema !== "paperclip-ru-lifecycle-journal/v2" || typeof journal.installDir !== "string" || pathKey(journal.installDir) !== pathKey(installDir)
    || journal.recoveryDir !== `${file}.recovery` || !["install", "update", "uninstall"].includes(journal.action)
    || !journal.serverDir || !Array.isArray(journal.siblingPaths)
    || JSON.stringify(journal.siblingPaths) !== JSON.stringify([".staging", ".prev", ".deleting"].map((s) => `${journal.installDir}${s}`))) {
    throw new Error("lifecycle: invalid recovery journal");
  }
  assertSafeInstallDir(installDir, { serverDir: journal.serverDir });
  if (!Array.isArray(journal.createdParents) || journal.createdParents.some((p, i) => p !== path.dirname(i ? journal.createdParents[i - 1] : journal.installDir) || p === path.parse(p).root)) throw new Error('lifecycle: invalid parent inventory');
  for (const p of journal.siblingPaths) assertSafeInstallDir(p, { serverDir: journal.serverDir });
  if (journal.ready) {
    for (const [key, root] of [["install", journal.installDir], ["ui", path.join(journal.serverDir, "ui-dist")]]) {
      const snapshot = journal.snapshots?.[key];
      if (snapshot?.root !== root || snapshot?.storage !== path.join(journal.recoveryDir, key)) {
        throw new Error("lifecycle: recovery roots differ");
      }
      validateSnapshot(snapshot);
    }
  }
}

function cleanup(tx) {
  const { file, journal, step } = tx;
  // The terminal journal survives until all other evidence is removed.
  removeTree(journal.recoveryDir, step, "remove-lifecycle-snapshot");
  hit("remove-lifecycle-journal");
  fs.unlinkSync(file);
  hit("remove-lifecycle-journal", { after: true });
}

export function rollbackLifecycle(tx, verifyPrevious) {
  const { file, journal, step } = tx;
  validateJournal(journal.installDir, file, journal);
  if (journal.ready) {
    assertRecoveryLive(journal);
    const server = { uiDist: path.join(journal.serverDir, 'ui-dist') };
    const recovered = recoverUnfinishedJournal({ server, work: workPaths(server) });
    if (recovered.blocked) throw new Error(recovered.reason);
    restoreTree(journal.snapshots.install, step);
    restoreTree(journal.snapshots.ui, step);
    if (journal.snapshots.install.inventory.existed) verifyPrevious?.(journal.preState);
  }
  for (const p of journal.siblingPaths) removeTree(p, step, "remove-lifecycle-sibling");
  for (const p of journal.createdParents) if (fs.existsSync(p)) step('rollback-remove-install-parent', () => fs.rmdirSync(p));
  journal.recovery = "rolled-back";
  journal.stage = "rolled-back";
  persist(file, journal);
  cleanup(tx);
  return { recovered: true, action: "restore-prev", rollbackOk: true };
}

export function commitLifecycle(tx) {
  const completed = { ...tx.journal, recovery: "complete", stage: "complete" };
  try { persist(tx.file, completed); }
  catch (err) {
    if (readLifecycleJournal(completed.installDir)?.recovery !== 'complete') throw err;
  }
  Object.assign(tx.journal, completed);
  try { cleanup(tx); }
  catch (err) {
    if (fs.existsSync(tx.file)) return { warning: `Операция проверена и завершена; очистка recovery будет продолжена при следующей lifecycle-команде (${err.message}).` };
  }
  return { warning: null };
}

export function recoverLifecycle(installDir, { dryRun = false, verifyPrevious } = {}) {
  const file = lifecycleJournalPath(installDir);
  const journal = readLifecycleJournal(installDir);
  if (!journal) return { recovered: false };
  if (dryRun) return { recovered: false, blocked: true, journal, reason: "pending-lifecycle-recovery" };
  try {
    if (journal.ownerPid && journal.ownerPid !== process.pid) {
      let alive = false;
      try { process.kill(journal.ownerPid, 0); alive = true; } catch { /* process exited */ }
      if (alive) throw new Error("lifecycle: another process is using this installation");
    }
    const tx = { file, journal, step: transactionStep(file, journal) };
    if (["complete", "rolled-back"].includes(journal.recovery)) {
      // Snapshots may already be partly removed; their paths still must match.
      validateJournal(installDir, file, { ...journal, ready: false });
      cleanup(tx);
      return { recovered: true, action: "finish-cleanup" };
    }
    return rollbackLifecycle(tx, verifyPrevious);
  } catch (err) {
    return { recovered: false, blocked: true, journal, reason: err.message };
  }
}
