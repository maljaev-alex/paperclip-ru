import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_SERVER = path.resolve(HERE, "../fixtures/server");
export const PROJECT_ROOT = path.resolve(HERE, "../..");
export const TOOL = path.join(PROJECT_ROOT, "tools", "paperclip-ru.mjs");

export function assertInsideTmp(dir) {
  const tmp = fs.realpathSync(os.tmpdir());
  const real = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
  const rel = path.relative(tmp, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`temp escaped os.tmpdir(): ${dir}`);
  }
  return real;
}

export function trackTemp(t, dir) {
  if (t?.after) {
    t.after(() => {
      try {
        const real = assertInsideTmp(dir);
        if (fs.existsSync(real)) fs.rmSync(real, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });
  }
  return dir;
}

const LIVE_TEMPS = new Set();
let exitHooked = false;
function hookExitCleanup() {
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", () => {
    for (const dir of LIVE_TEMPS) {
      try {
        const real = assertInsideTmp(dir);
        if (fs.existsSync(real)) fs.rmSync(real, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
}

export function createTestRoot(label = "pc-ru", t = null) {
  const tmp = fs.realpathSync(os.tmpdir());
  const base = path.join(tmp, "paperclip-ru-tests");
  fs.mkdirSync(base, { recursive: true });
  const realBase = fs.realpathSync(base);
  const relBase = path.relative(tmp, realBase);
  if (!relBase || relBase.startsWith("..") || path.isAbsolute(relBase)) {
    throw new Error("test temp escaped os.tmpdir()");
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(realBase, `${label}-`)));
  LIVE_TEMPS.add(dir);
  hookExitCleanup();
  return t ? trackTemp(t, dir) : dir;
}

export function makeTempServer({ label = "pc-ru", cyrillic = false, t = null } = {}) {
  const base = createTestRoot("fx", t);
  const name = cyrillic ? `фикст ${label}` : label;
  const dest = path.join(base, name);
  fs.cpSync(FIXTURE_SERVER, dest, { recursive: true });
  return dest;
}

export function cleanupTestRoots() {
  const tmp = fs.realpathSync(os.tmpdir());
  const base = path.join(tmp, "paperclip-ru-tests");
  if (!fs.existsSync(base)) return;
  const real = fs.realpathSync(base);
  if (!path.relative(tmp, real) || path.relative(tmp, real).startsWith("..")) return;
  fs.rmSync(real, { recursive: true, force: true });
}

export function runTool(args, { env = process.env, cwd = PROJECT_ROOT, tool = TOOL } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tool, ...args], {
      cwd,
      env: { ...env, NO_COLOR: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: String(err) }));
  });
}

export function shaFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function walkFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

export function treeHashes(root) {
  const map = {};
  for (const file of walkFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    map[rel] = shaFile(file);
  }
  return map;
}

export function treeInventory(root) {
  const map = {};
  const dirs = {};
  const walk = (dir, relBase) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        dirs[rel] = { type: "dir", mode: fs.statSync(p).mode & 0o777 };
        walk(p, rel);
      } else {
        const st = fs.statSync(p);
        map[rel] = { hash: shaFile(p), size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777 };
      }
    }
  };
  walk(root, "");
  Object.defineProperty(map, "__dirs", { value: dirs, enumerable: false });
  return map;
}

export function assertInventoryUnchanged(before, root) {
  const after = treeInventory(root);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const rel of keys) {
    if (!before[rel]) throw new Error(`inventory: появился ${rel}`);
    if (!after[rel]) throw new Error(`inventory: исчез ${rel}`);
    if (before[rel].hash !== after[rel].hash) throw new Error(`inventory: hash ${rel}`);
    if (before[rel].size !== after[rel].size) throw new Error(`inventory: size ${rel}`);
    if (before[rel].mode !== after[rel].mode) throw new Error(`inventory: mode ${rel}`);
    if (Math.abs(before[rel].mtimeMs - after[rel].mtimeMs) > 2) {
      throw new Error(`inventory: mtime ${rel} (${before[rel].mtimeMs} -> ${after[rel].mtimeMs})`);
    }
  }
  const beforeDirs = new Set(Object.keys(before.__dirs || {}));
  const afterDirs = new Set(Object.keys(after.__dirs || {}));
  for (const rel of afterDirs) {
    if (!beforeDirs.has(rel)) throw new Error(`inventory: появился каталог ${rel}`);
  }
  for (const rel of beforeDirs) {
    if (!afterDirs.has(rel)) throw new Error(`inventory: исчез каталог ${rel}`);
    if (before.__dirs[rel].mode !== after.__dirs[rel].mode) throw new Error(`inventory: directory mode ${rel}`);
  }
}

void os;
