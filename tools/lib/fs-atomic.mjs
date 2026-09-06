import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EXIT } from "./constants.mjs";
import { hit } from "./failpoints.mjs";

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function readText(file) {
  return fs.readFileSync(file, "utf8");
}

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

export function isPermissionError(err) {
  return err && (err.code === "EACCES" || err.code === "EPERM" || err.code === "EROFS");
}

export class ToolError extends Error {
  constructor(message, { exitCode = EXIT.ERROR, nextAction = "none", details = null, result = null } = {}) {
    super(message);
    this.name = "ToolError";
    this.exitCode = exitCode;
    this.nextAction = nextAction;
    this.details = details;
    this.result = result;
  }
}

export function hashFile(file) {
  return sha256(fs.readFileSync(file));
}

/**
 * Resolves symlinks/junctions and refuses any path that would write outside root.
 */
export function assertInside(root, candidate) {
  const absRoot = path.resolve(root);
  const abs = path.resolve(candidate);
  const rel = path.relative(absRoot, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new ToolError("Refused path outside the selected root", { exitCode: EXIT.CONFLICT });
  }
  // Inspect each existing component, including a link whose target is missing.
  // Resolving only the nearest parent misses junctions above a missing directory.
  let current = absRoot;
  for (const part of ["", ...rel.split(path.sep)]) {
    if (part) current = path.join(current, part);
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) throw new ToolError("Refused symlink/junction in target path", { exitCode: EXIT.CONFLICT });
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  return abs;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Write via a temp file in the same directory, then rename over the target.
 * On failure the target is left untouched if the rename did not happen.
 */
const ATOMIC_TMP_RE = /^\..+\.\d+\.[0-9a-f]{8}\.tmp$/i;

export function cleanupAtomicTemps(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    if (!ATOMIC_TMP_RE.test(name)) continue;
    const dest = path.join(dir, name);
    try {
      fs.rmSync(dest, { force: true });
      removed.push(name);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export function atomicWriteFile(target, data, { mode: requestedMode } = {}) {
  const dir = path.dirname(target);
  ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  try {
    hit("atomic-write-temp");
    const existingMode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : undefined;
    const mode = requestedMode ?? existingMode ?? 0o644;
    const fd = fs.openSync(tmp, "wx", mode);
    try {
      fs.writeFileSync(fd, data);
      // open() applies umask; replacement/recovery must retain the proven mode.
      // A newly created file without an explicit mode still respects umask.
      if (process.platform !== "win32" && (requestedMode != null || existingMode != null)) fs.fchmodSync(fd, mode);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    hit("atomic-write-temp", { after: true });
    hit("atomic-rename");
    for (let attempt = 0; ; attempt += 1) {
      try { fs.renameSync(tmp, target); break; }
      catch (error) {
        // Windows readers/antivirus may briefly deny delete sharing. Preserve
        // the target and retry the same rename for at most 500 ms, then fail.
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 20) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    hit("atomic-rename", { after: true });
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore cleanup */
    }
    throw err;
  }
}

export function copyFileAtomic(src, dest) {
  const data = fs.readFileSync(src);
  atomicWriteFile(dest, data);
}
