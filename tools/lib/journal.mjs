import fs from "node:fs";
import path from "node:path";
import { assertInside, atomicWriteFile, ensureDir, hashFile, sha256 } from "./fs-atomic.mjs";
import { hit } from "./failpoints.mjs";
import { isSafeOwnedRel } from "./manifest.mjs";

export function inventoryDir(dir) {
  const files = {};
  const dirs = {};
  if (!dir || !fs.existsSync(dir)) return { existed: false, files, dirs };
  const walk = (current, relBase) => {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const p = path.join(current, ent.name);
      if (ent.isSymbolicLink()) throw new Error(`journal: link at ${rel}`);
      assertInside(dir, p);
      if (ent.isDirectory()) {
        dirs[rel] = { type: "dir", mode: fs.statSync(p).mode & 0o777 };
        walk(p, rel);
      } else {
        const st = fs.statSync(p);
        files[rel] = { type: "file", hash: hashFile(p), size: st.size, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs, mode: st.mode & 0o777 };
      }
    }
  };
  walk(dir, "");
  return { existed: true, files, dirs, mode: fs.statSync(dir).mode & 0o777 };
}

export function hashesOfMap(map) {
  const out = {};
  for (const [rel, buf] of map) out[rel] = sha256(buf);
  return out;
}

export function persistJournal(work, journal) {
  hit("write-journal");
  ensureDir(work.root);
  assertInside(work.root, work.journal);
  atomicWriteFile(work.journal, `${JSON.stringify(journal, null, 2)}\n`);
  hit("write-journal", { after: true });
  return journal;
}

export function beginJournal(work, journal) {
  hit("write-journal");
  ensureDir(work.root);
  assertInside(work.root, work.journal);
  const fd = fs.openSync(work.journal, "wx", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(journal)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  hit("write-journal", { after: true });
}

export function pendingJournal(work) {
  const journal = readJournal(work);
  return journal && !["complete", "rolled-back"].includes(journal.recovery) ? journal : null;
}

export function readJournal(work) {
  if (!work?.journal || !fs.existsSync(work.journal)) return null;
  try {
    return JSON.parse(fs.readFileSync(work.journal, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { stage: "corrupt", recovery: "unproven" };
  }
}

export function newJournal({ action, server, work, snapLive, snapWork, createdLive }) {
  return {
    schema: "paperclip-ru-journal/v1",
    id: `${Date.now()}-${process.pid}`,
    ownerPid: process.pid,
    action,
    stage: "prepared",
    recovery: "pending",
    startedAt: new Date().toISOString(),
    roots: {
      uiDist: server.uiDist,
      work: work.root,
      manifest: work.manifest,
      overlay: path.posix.join("assets", "paperclip-ru-overlay.js"),
    },
    existedBefore: [...snapLive.keys()],
    createdByTransaction: [...createdLive],
    oldHashes: hashesOfMap(snapLive),
    oldMtimes: Object.fromEntries([...snapLive].map(([rel, buf]) => [rel, buf._mtime ? Number(buf._mtime) : null])),
    oldAtimes: Object.fromEntries([...snapLive].map(([rel, buf]) => [rel, buf._atime ? Number(buf._atime) : null])),
    oldModes: Object.fromEntries([...snapLive].map(([rel, buf]) => [rel, buf._mode])),
    workExistedBefore: snapWork.existed,
    workModeBefore: snapWork.mode,
    workInventoryBefore: inventoryDir(work.root).files,
    workInventoryDirsBefore: inventoryDir(work.root).dirs,
    liveInventoryBefore: liveInventory(server.uiDist, work.root),
    newHashes: {},
    steps: [],
  };
}

export function recordJournalStep(work, journal, op, rel, extra = {}) {
  journal.steps.push({ op, rel: rel || null, ...extra, at: new Date().toISOString() });
  journal.stage = `${op}:${rel || ""}`;
  persistJournal(work, journal);
  return journal;
}

export function persistRecoverySnapshots({ work, snapLive, snapWork, journal }) {
  const root = path.join(work.root, "recovery");
  const step = (label, fn) => journal ? journalStep(work, journal, label, fn) : fn();
  for (const [kind, files] of [["live", snapLive], ["work", snapWork.files]]) {
    for (const [rel, buf] of files) {
      const dest = path.join(root, kind, rel);
      assertInside(root, dest);
      step("snapshot-mkdir", () => ensureDir(path.dirname(dest)));
      step("snapshot-write", () => atomicWriteFile(dest, buf, { mode: 0o600 }));
    }
  }
  if (journal) {
    journal.snapshotsReady = true;
    persistJournal(work, journal);
  }
  return root;
}

export function journalStep(work, journal, label, action, extra = {}) {
  Object.assign(journal, { stage: `before:${label}`, operation: { label, ...extra } });
  persistJournal(work, journal);
  hit(label);
  const result = action();
  journal.stage = `after:${label}`;
  persistJournal(work, journal);
  hit(label, { after: true });
  return result;
}

function liveInventory(uiDist, workRoot) {
  const all = inventoryDir(uiDist);
  const excluded = path.relative(uiDist, workRoot).split(path.sep).join("/");
  const outsideWork = (rel) => rel !== excluded && !rel.startsWith(`${excluded}/`);
  all.files = Object.fromEntries(Object.entries(all.files).filter(([rel]) => outsideWork(rel)));
  all.dirs = Object.fromEntries(Object.entries(all.dirs).filter(([rel]) => outsideWork(rel)));
  return all;
}

const isEvidence = (rel) => rel === "journal.json" || rel === "recovery" || rel.startsWith("recovery/");
const timeMatches = (a, b) => b == null || Math.abs(Number(a) - Number(b)) <= 2;
const modeMatches = (actual, expected) => expected == null || (actual & 0o777) === expected;
const validMode = (mode) => Number.isInteger(mode) && mode >= 0 && mode <= 0o777;

export function selfCheckRollback({ server, snapLive, createdLive, snapWork, work, journal }) {
  for (const [rel, buf] of snapLive) {
    const file = path.join(server.uiDist, rel);
    if (!fs.existsSync(file) || hashFile(file) !== sha256(buf) || !timeMatches(fs.statSync(file).mtimeMs, buf._mtime)
      || !modeMatches(fs.statSync(file).mode, buf._mode)) {
      return { ok: false, reason: "live-mismatch", file: rel };
    }
  }
  for (const rel of createdLive) {
    if (!snapLive.has(rel) && fs.existsSync(path.join(server.uiDist, rel))) return { ok: false, reason: "created-live-remains", file: rel };
  }
  if (journal?.liveInventoryBefore) {
    const expected = journal.liveInventoryBefore;
    const actual = liveInventory(server.uiDist, work.root);
    if (JSON.stringify(Object.keys(expected.dirs).sort()) !== JSON.stringify(Object.keys(actual.dirs).sort())
      || JSON.stringify(Object.keys(expected.files).sort()) !== JSON.stringify(Object.keys(actual.files).sort())) {
      return { ok: false, reason: "full-live-inventory" };
    }
    for (const [rel, rec] of Object.entries(expected.files)) {
      if (rec.hash !== actual.files[rel].hash || !timeMatches(actual.files[rel].mtimeMs, rec.mtimeMs)
        || !modeMatches(actual.files[rel].mode, rec.mode)) {
        return { ok: false, reason: "full-live-hash-time-or-mode", file: rel };
      }
    }
    for (const [rel, rec] of Object.entries(expected.dirs)) {
      if (!modeMatches(actual.dirs[rel].mode, rec.mode)) return { ok: false, reason: "live-directory-mode", file: rel };
    }
  }
  const current = inventoryDir(work.root);
  const files = Object.keys(current.files).filter((rel) => !isEvidence(rel)).sort();
  const dirs = Object.keys(current.dirs).filter((rel) => !isEvidence(rel)).sort();
  if (JSON.stringify(files) !== JSON.stringify([...snapWork.files.keys()].sort())
    || JSON.stringify(dirs) !== JSON.stringify(Object.keys(snapWork.dirs || {}).sort())) return { ok: false, reason: "work-inventory" };
  for (const [rel, buf] of snapWork.files) {
    if (current.files[rel]?.hash !== sha256(buf) || !timeMatches(current.files[rel]?.mtimeMs, buf._mtime)
      || !modeMatches(current.files[rel]?.mode, buf._mode)) {
      return { ok: false, reason: "work-hash-time-or-mode", file: rel };
    }
  }
  for (const [rel, rec] of Object.entries(snapWork.dirs || {})) {
    if (!modeMatches(current.dirs[rel]?.mode, rec.mode)) return { ok: false, reason: "work-directory-mode", file: rel };
  }
  if (snapWork.existed && !modeMatches(current.mode, snapWork.mode)) return { ok: false, reason: "work-root-mode" };
  return { ok: true };
}

export function restoreSnapshotMaps({ server, work, snapLive, snapWork, createdLive, journal }) {
  const step = (label, fn, extra) => journalStep(work, journal, label, fn, extra);
  const write = (root, rel, buf) => {
    const dest = path.join(root, rel);
    assertInside(root, dest);
    if (!fs.existsSync(path.dirname(dest))) step("rollback-mkdir", () => ensureDir(path.dirname(dest)), { rel });
    if (!fs.existsSync(dest) || hashFile(dest) !== sha256(buf)) step("rollback-write", () => atomicWriteFile(dest, buf, { mode: buf._mode }), { rel });
    if (!modeMatches(fs.statSync(dest).mode, buf._mode)) step("rollback-chmod", () => fs.chmodSync(dest, buf._mode), { rel });
    if (buf._mtime != null && !timeMatches(fs.statSync(dest).mtimeMs, buf._mtime)) {
      step("rollback-utimes", () => fs.utimesSync(dest, Number(buf._atime || buf._mtime) / 1000, Number(buf._mtime) / 1000), { rel });
    }
  };
  for (const [rel, buf] of snapLive) write(server.uiDist, rel, buf);
  for (const rel of createdLive) {
    const file = path.join(server.uiDist, rel);
    assertInside(server.uiDist, file);
    if (!snapLive.has(rel) && fs.existsSync(file)) step(`remove:${rel}`, () => fs.unlinkSync(file));
  }
  const current = inventoryDir(work.root);
  for (const rel of Object.keys(current.files)) {
    if (isEvidence(rel) || snapWork.files.has(rel)) continue;
    step("rollback-remove-work-file", () => fs.unlinkSync(path.join(work.root, rel)), { rel });
  }
  for (const rel of Object.keys(current.dirs).sort((a, b) => b.length - a.length)) {
    if (isEvidence(rel) || snapWork.dirs?.[rel]) continue;
    step("rollback-remove-work-directory", () => fs.rmdirSync(path.join(work.root, rel)), { rel });
  }
  for (const rel of Object.keys(snapWork.dirs || {}).sort((a, b) => a.length - b.length)) {
    const dir = path.join(work.root, rel);
    if (!fs.existsSync(dir)) step("rollback-mkdir", () => {
      const mode = snapWork.dirs[rel].mode;
      fs.mkdirSync(dir, { mode });
      if (mode != null) fs.chmodSync(dir, mode);
    }, { rel });
  }
  for (const [rel, buf] of snapWork.files) write(work.root, rel, buf);
  for (const [rel, rec] of Object.entries(snapWork.dirs || {}).sort(([a], [b]) => b.length - a.length)) {
    const dir = path.join(work.root, rel);
    if (!modeMatches(fs.statSync(dir).mode, rec.mode)) step("rollback-chmod", () => fs.chmodSync(dir, rec.mode), { rel });
  }
  if (snapWork.existed && !modeMatches(fs.statSync(work.root).mode, snapWork.mode)) {
    step("rollback-chmod", () => fs.chmodSync(work.root, snapWork.mode), { rel: "." });
  }
  const proof = selfCheckRollback({ server, snapLive, createdLive, snapWork, work, journal });
  if (!proof.ok) throw new Error(`rollback not proved: ${proof.reason}`);
  return proof;
}

export function cleanupJournal(work, journal, { removeWorkRoot = false } = {}) {
  const step = (label, fn, extra) => journalStep(work, journal, label, fn, extra);
  const root = path.join(work.root, "recovery");
  const inv = inventoryDir(root);
  for (const rel of Object.keys(inv.files)) step("remove-recovery-file", () => fs.unlinkSync(path.join(root, rel)), { rel });
  for (const rel of Object.keys(inv.dirs).sort((a, b) => b.length - a.length)) {
    step("remove-recovery-directory", () => fs.rmdirSync(path.join(root, rel)), { rel });
  }
  if (fs.existsSync(root)) step("remove-recovery-directory", () => fs.rmdirSync(root));
  journal.stage = "complete";
  persistJournal(work, journal);
  hit("remove-journal");
  fs.unlinkSync(work.journal);
  if (removeWorkRoot && fs.existsSync(work.root) && fs.readdirSync(work.root).length === 0) fs.rmdirSync(work.root);
  hit("remove-journal", { after: true });
}

function validateRecoveryLive(server, work, journal) {
  const before = journal.liveInventoryBefore;
  const now = liveInventory(server.uiDist, work.root);
  if (!before?.files || !before?.dirs) throw new Error("missing live inventory");
  const known = new Set([...Object.keys(before.files), ...(journal.createdByTransaction || [])]);
  for (const rel of Object.keys(now.files)) if (!known.has(rel)) throw new Error(`unowned recovery live file: ${rel}`);
  if (JSON.stringify(Object.keys(before.dirs).sort()) !== JSON.stringify(Object.keys(now.dirs).sort())) throw new Error("unowned recovery live directory");
  for (const [rel, rec] of Object.entries(before.dirs)) {
    if (!modeMatches(now.dirs[rel].mode, rec.mode)) throw new Error(`external directory mode change blocks recovery: ${rel}`);
  }
  for (const rel of known) {
    const oldHash = before.files[rel]?.hash ?? null;
    const current = now.files[rel]?.hash ?? null;
    const planned = journal.snapshotsReady && Object.hasOwn(journal.newHashes || {}, rel) ? journal.newHashes[rel] : oldHash;
    if (current !== oldHash && current !== planned) throw new Error(`external change blocks recovery: ${rel}`);
    if (now.files[rel] && !modeMatches(now.files[rel].mode, before.files[rel]?.mode)) throw new Error(`external file mode change blocks recovery: ${rel}`);
  }
}

function recoveryBuffers({ work, server, journal }) {
  if (journal.schema !== "paperclip-ru-journal/v1" || journal.roots?.uiDist !== server.uiDist
    || journal.roots?.work !== work.root || !journal.oldHashes || !journal.workInventoryBefore
    || !Array.isArray(journal.createdByTransaction) || !journal.liveInventoryBefore) throw new Error("invalid journal schema/roots");
  validateRecoveryLive(server, work, journal);
  const live = new Map();
  const savedWork = new Map();
  const readProved = (kind, rel, rec, current) => {
    const source = path.join(work.root, "recovery", kind, rel);
    assertInside(work.root, source);
    assertInside(kind === "live" ? server.uiDist : work.root, current);
    const candidate = fs.existsSync(source) ? source : current;
    if (!fs.existsSync(candidate) || hashFile(candidate) !== rec.hash) throw new Error(`unproven recovery bytes: ${kind}/${rel}`);
    const buf = fs.readFileSync(candidate);
    // Older pending journals have no proof of deleted files' original modes.
    // On POSIX refuse recovery instead of exposing them with guessed defaults.
    if (process.platform !== "win32" && !validMode(rec.mode)) throw new Error(`unproven recovery mode: ${kind}/${rel}`);
    if (rec.mode != null && !validMode(rec.mode)) throw new Error(`invalid recovery mode: ${kind}/${rel}`);
    buf._mtime = rec.mtimeMs;
    buf._atime = rec.atimeMs;
    buf._mode = rec.mode;
    return buf;
  };
  for (const [rel, expected] of Object.entries(journal.oldHashes)) {
    if (!isSafeOwnedRel(rel) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("unsafe recovery live path/hash");
    live.set(rel, readProved("live", rel, { hash: expected, mtimeMs: journal.oldMtimes?.[rel], atimeMs: journal.oldAtimes?.[rel], mode: journal.oldModes?.[rel] }, path.join(server.uiDist, rel)));
  }
  for (const rel of journal.createdByTransaction) if (!isSafeOwnedRel(rel)) throw new Error("unsafe created live path");
  for (const [rel, rec] of Object.entries(journal.workInventoryBefore)) {
    if (rel.includes("\\") || /[:\x00-\x1f]/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === "..") || isEvidence(rel)) {
      throw new Error("unsafe recovery work path");
    }
    savedWork.set(rel, readProved("work", rel, rec, path.join(work.root, rel)));
  }
  for (const [rel, rec] of Object.entries(journal.workInventoryDirsBefore || {})) {
    if (rel.includes("\\") || /[:\x00-\x1f]/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === "..") || isEvidence(rel)) throw new Error("unsafe work directory");
    assertInside(work.root, path.join(work.root, rel));
    if ((process.platform !== "win32" || rec.mode != null) && !validMode(rec.mode)) throw new Error(`unproven recovery directory mode: ${rel}`);
  }
  if (journal.workExistedBefore && (process.platform !== "win32" || journal.workModeBefore != null) && !validMode(journal.workModeBefore)) throw new Error("unproven recovery work root mode");
  return { snapLive: live, snapWork: { existed: journal.workExistedBefore, files: savedWork, dirs: journal.workInventoryDirsBefore || {}, mode: journal.workModeBefore } };
}

function validateRecoveryWork({ work, journal }) {
  const inventory = inventoryDir(work.root);
  const old = journal.workInventoryBefore || {};
  const current = journal.newHashes || {};
  if (journal.workExistedBefore && !modeMatches(inventory.mode, journal.workModeBefore)) throw new Error("external work root mode change blocks recovery");
  for (const [rel, rec] of Object.entries(inventory.files)) {
    if (old[rel] && !modeMatches(rec.mode, old[rel].mode)) throw new Error(`external work file mode change blocks recovery: ${rel}`);
    if (rel === 'journal.json' || old[rel]?.hash === rec.hash) continue;
    if (rel.startsWith('recovery/live/') && journal.oldHashes?.[rel.slice(14)] === rec.hash) continue;
    if (rel.startsWith('recovery/work/') && old[rel.slice(14)]?.hash === rec.hash) continue;
    if (rel.startsWith('staging/') && current[rel.slice(8)] === rec.hash) continue;
    if (rel.startsWith('baseline/')) {
      const original = rel.slice(9);
      if (journal.oldHashes?.[original] === rec.hash || journal.liveInventoryBefore?.files?.[original]?.hash === rec.hash) continue;
    }
    if (rel === 'manifest.json' || rel === 'staging/manifest.json') {
      const manifest = JSON.parse(fs.readFileSync(path.join(work.root, rel), 'utf8'));
      if (manifest.schema === 'paperclip-ru-manifest/v3' && Object.entries(manifest.files || {}).every(([p, hashes]) => current[p] === hashes.patchedHash && (journal.oldHashes?.[p] === hashes.baselineHash || old[`baseline/${p}`]?.hash === hashes.baselineHash))) continue;
    }
    throw new Error(`unowned or modified recovery work file: ${rel}`);
  }
  const knownFiles = [...Object.keys(old), ...Object.keys(journal.oldHashes || {}).flatMap(p => [`baseline/${p}`, `recovery/live/${p}`]), ...Object.keys(current).map(p => `staging/${p}`), ...Object.keys(old).map(p => `recovery/work/${p}`)];
  for (const rel of Object.keys(inventory.dirs)) {
    if (!modeMatches(inventory.dirs[rel].mode, journal.workInventoryDirsBefore?.[rel]?.mode)) throw new Error(`external work directory mode change blocks recovery: ${rel}`);
    if (journal.workInventoryDirsBefore?.[rel] || ['baseline', 'staging', 'recovery', 'recovery/live', 'recovery/work'].includes(rel) || knownFiles.some(p => p.startsWith(`${rel}/`))) continue;
    throw new Error(`unowned recovery work directory: ${rel}`);
  }
}

export function inspectJournalRecovery({ work, server }) {
  const journal = readJournal(work);
  if (!journal) return null;
  if (journal.schema !== 'paperclip-ru-journal/v1' || journal.roots?.uiDist !== server.uiDist || journal.roots?.work !== work.root) throw new Error('invalid journal schema/roots');
  if (journal.ownerPid && journal.ownerPid !== process.pid) {
    let alive = false;
    try { process.kill(journal.ownerPid, 0); alive = true; } catch { /* exited */ }
    if (alive) throw new Error('another process owns the UI transaction');
  }
  validateRecoveryLive(server, work, journal);
  validateRecoveryWork({ work, journal });
  if (!['complete', 'rolled-back'].includes(journal.recovery)) recoveryBuffers({ work, server, journal });
  return journal;
}

export function recoverUnfinishedJournal({ work, server }) {
  const journal = readJournal(work);
  if (!journal) return { recovered: false };
  try {
    inspectJournalRecovery({ work, server });
    if (journal.ownerPid && journal.ownerPid !== process.pid) {
      let alive = false;
      try { process.kill(journal.ownerPid, 0); alive = true; } catch { /* exited */ }
      if (alive) throw new Error("another process owns the UI transaction");
    }
    if (journal.schema !== "paperclip-ru-journal/v1" || journal.roots?.uiDist !== server.uiDist || journal.roots?.work !== work.root) {
      throw new Error("invalid journal schema/roots");
    }
    if (journal.recovery === "complete" || journal.recovery === "rolled-back") {
      cleanupJournal(work, journal, { removeWorkRoot: journal.action === "revert" || (journal.recovery === "rolled-back" && !journal.workExistedBefore) });
      return { recovered: true };
    }
    const buffers = recoveryBuffers({ work, server, journal });
    // All source bytes are validated above before recovery is allowed to write.
    restoreSnapshotMaps({ server, work, journal, ...buffers, createdLive: journal.createdByTransaction });
    journal.recovery = "rolled-back";
    persistJournal(work, journal);
    cleanupJournal(work, journal, { removeWorkRoot: !buffers.snapWork.existed });
    return { recovered: true };
  } catch (err) { return { recovered: false, blocked: true, journal, reason: err.message }; }
}
