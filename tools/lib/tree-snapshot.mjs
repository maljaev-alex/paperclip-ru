import fs from "node:fs";
import path from "node:path";
import { assertInside, atomicWriteFile, hashFile } from "./fs-atomic.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const names = (object) => Object.keys(object).sort();

export function treeInventory(root) {
  const result = { existed: fs.existsSync(root), files: {}, dirs: {} };
  if (!result.existed) return result;
  const visit = (dir, rel) => {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("snapshot: root/directory must not be a link");
    result.dirs[rel] = { mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs };
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const file = path.join(root, child);
      assertInside(root, file);
      if (entry.isSymbolicLink()) throw new Error(`snapshot: link at ${child}`);
      if (entry.isDirectory()) visit(file, child);
      else {
        const st = fs.lstatSync(file);
        if (!st.isFile() || st.nlink > 1) throw new Error(`snapshot: special/hardlinked file at ${child}`);
        result.files[child] = { hash: hashFile(file), size: st.size, mode: st.mode & 0o777, mtimeMs: st.mtimeMs };
      }
    }
  };
  visit(root, "");
  return result;
}

export function compareTree(expected, root, { mtimes = true, directoryMtimes = false } = {}) {
  const actual = treeInventory(root);
  if (expected.existed !== actual.existed || !same(names(expected.files), names(actual.files))
    || !same(names(expected.dirs), names(actual.dirs))) return { ok: false, reason: "inventory-mismatch" };
  for (const [rel, rec] of Object.entries(expected.files)) {
    const now = actual.files[rel];
    if (rec.hash !== now.hash || rec.size !== now.size || rec.mode !== now.mode
      || (mtimes && Math.abs(rec.mtimeMs - now.mtimeMs) > 2)) return { ok: false, reason: "file-mismatch", file: rel };
  }
  for (const [rel, rec] of Object.entries(expected.dirs)) {
    const now = actual.dirs[rel];
    if (rec.mode !== now.mode || (directoryMtimes && Math.abs(rec.mtimeMs - now.mtimeMs) > 2)) {
      return { ok: false, reason: "directory-mismatch", file: rel };
    }
  }
  return { ok: true };
}

const direct = (_label, action) => action();

export function captureTree(root, snapshotRoot, step = direct) {
  const inventory = treeInventory(root);
  step("snapshot-mkdir", () => fs.mkdirSync(snapshotRoot, { recursive: true }));
  for (const rel of Object.keys(inventory.files)) {
    const dest = path.join(snapshotRoot, rel);
    assertInside(snapshotRoot, dest);
    step("snapshot-mkdir", () => fs.mkdirSync(path.dirname(dest), { recursive: true }));
    step("snapshot-write", () => atomicWriteFile(dest, fs.readFileSync(path.join(root, rel))));
  }
  const snapshot = { root: path.resolve(root), storage: path.resolve(snapshotRoot), inventory };
  validateSnapshot(snapshot);
  return snapshot;
}

export function validateSnapshot(snapshot) {
  const inv = snapshot?.inventory;
  if (!inv || typeof inv.existed !== "boolean" || !inv.files || !inv.dirs) throw new Error("snapshot: invalid inventory");
  for (const rel of [...Object.keys(inv.files), ...Object.keys(inv.dirs)]) {
    if (rel === "" && inv.dirs[rel]) continue;
    if (rel.includes("\\") || rel.split("/").some((p) => !p || p === "." || p === "..") || /[:\x00-\x1f]/.test(rel)) {
      throw new Error("snapshot: unsafe path");
    }
    assertInside(snapshot.root, path.join(snapshot.root, rel));
    assertInside(snapshot.storage, path.join(snapshot.storage, rel));
  }
  for (const [rel, rec] of Object.entries(inv.files)) {
    const file = path.join(snapshot.storage, rel);
    if (!/^[a-f0-9]{64}$/.test(rec.hash) || !Number.isFinite(rec.mtimeMs) || !fs.existsSync(file)
      || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size !== rec.size || hashFile(file) !== rec.hash) {
      throw new Error(`snapshot: unproven bytes at ${rel}`);
    }
  }
  return snapshot;
}

export function removeTree(root, step = direct, label = "remove") {
  if (!fs.existsSync(root)) return;
  const inv = treeInventory(root);
  for (const rel of Object.keys(inv.files)) {
    assertInside(root, path.join(root, rel));
    step(label, () => fs.unlinkSync(path.join(root, rel)), rel);
  }
  for (const rel of Object.keys(inv.dirs).sort((a, b) => b.length - a.length)) {
    if (rel) assertInside(root, path.join(root, rel));
    step(`${label}-directory`, () => fs.rmdirSync(path.join(root, rel)), rel);
  }
}

export function restoreTree(snapshot, step = direct) {
  validateSnapshot(snapshot);
  const { root, storage, inventory: expected } = snapshot;
  const actual = treeInventory(root);
  // A complete snapshot is validated before touching any live file.
  for (const rel of Object.keys(actual.files)) {
    if (!expected.files[rel]) step("rollback-remove", () => fs.unlinkSync(path.join(root, rel)), rel);
  }
  for (const rel of Object.keys(actual.dirs).sort((a, b) => b.length - a.length)) {
    if (!expected.dirs[rel]) step("rollback-remove-directory", () => fs.rmdirSync(path.join(root, rel)), rel);
  }
  if (expected.existed) {
    for (const rel of Object.keys(expected.dirs).sort((a, b) => a.length - b.length)) {
      const dest = path.join(root, rel);
      if (!fs.existsSync(dest)) step("rollback-mkdir", () => fs.mkdirSync(dest), rel);
    }
    for (const [rel, rec] of Object.entries(expected.files)) {
      const dest = path.join(root, rel);
      if (!fs.existsSync(dest) || hashFile(dest) !== rec.hash) {
        step("rollback-write", () => atomicWriteFile(dest, fs.readFileSync(path.join(storage, rel))), rel);
      }
      if ((fs.statSync(dest).mode & 0o777) !== rec.mode) step("rollback-chmod", () => fs.chmodSync(dest, rec.mode), rel);
      step("rollback-utimes", () => fs.utimesSync(dest, rec.mtimeMs / 1000, rec.mtimeMs / 1000), rel);
    }
    for (const [rel, rec] of Object.entries(expected.dirs).sort((a, b) => b[0].length - a[0].length)) {
      const dest = path.join(root, rel);
      if ((fs.statSync(dest).mode & 0o777) !== rec.mode) step("rollback-chmod", () => fs.chmodSync(dest, rec.mode), rel);
      step("rollback-utimes", () => fs.utimesSync(dest, rec.mtimeMs / 1000, rec.mtimeMs / 1000), rel);
    }
  }
  const checked = compareTree(expected, root, { directoryMtimes: true });
  if (!checked.ok) throw new Error(`snapshot: rollback self-check failed (${checked.reason}: ${checked.file || ""})`);
  return checked;
}
