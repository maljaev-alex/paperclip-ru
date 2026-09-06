import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXIT } from "./constants.mjs";
import { ToolError } from "./fs-atomic.mjs";

function realOrResolve(p) {
  const abs = path.resolve(p);
  try {
    if (fs.existsSync(abs)) return fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs);
  } catch {
    /* fall through */
  }
  return abs;
}

function samePath(a, b) {
  if (!a || !b) return false;
  const left = realOrResolve(a);
  const right = realOrResolve(b);
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function isInside(root, candidate) {
  const rel = path.relative(realOrResolve(root), realOrResolve(candidate));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Reject drive/fs root, home, profile roots, Paperclip ui-dist, empty, and
 * symlink/junction escapes from the intended parent.
 */
export function assertSafeInstallDir(installDir, { serverDir = null } = {}) {
  if (installDir == null || String(installDir).trim() === "") {
    throw new ToolError("Пустой install-dir запрещён.", { exitCode: EXIT.USAGE });
  }
  const abs = path.resolve(installDir);
  const parsed = path.parse(abs);
  if (samePath(abs, parsed.root) || abs === "/" || abs === "\\") {
    throw new ToolError(`Отказ: install-dir является корнем файловой системы: ${abs}`, { exitCode: EXIT.ERROR });
  }

  const home = os.homedir();
  const profile = process.env.USERPROFILE || home;
  const localApp = process.env.LOCALAPPDATA;
  const xdg = process.env.XDG_DATA_HOME;
  const forbiddenExact = [home, profile, localApp, xdg, process.env.APPDATA, process.env.TEMP, os.tmpdir()].filter(Boolean);
  for (const bad of forbiddenExact) {
    if (samePath(abs, bad)) {
      throw new ToolError(`Отказ: install-dir совпадает с системным корнем профиля/temp: ${abs}`, { exitCode: EXIT.ERROR });
    }
  }

  if (serverDir) {
    const serverAbs = path.resolve(serverDir);
    if (samePath(abs, serverAbs) || isInside(serverAbs, abs) || samePath(abs, path.join(serverAbs, "ui-dist"))) {
      throw new ToolError("Отказ: нельзя устанавливать инструмент в корень Paperclip или ui-dist.", { exitCode: EXIT.ERROR });
    }
  }

  let parent = path.dirname(abs);
  while (!fs.existsSync(parent) && parent !== path.dirname(parent)) parent = path.dirname(parent);
  if (fs.existsSync(parent)) {
    const realParent = fs.realpathSync(parent);
    const expectedParent = path.resolve(parent);
    if (process.platform === "win32") {
      if (realParent.toLowerCase() !== expectedParent.toLowerCase()) {
        throw new ToolError("Отказ: родитель install-dir является symlink/junction escape.", { exitCode: EXIT.ERROR });
      }
    } else if (realParent !== expectedParent) {
      throw new ToolError("Отказ: родитель install-dir является symlink/junction escape.", { exitCode: EXIT.ERROR });
    }
  }

  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    if (process.platform === "win32" ? real.toLowerCase() !== abs.toLowerCase() : real !== abs) {
      throw new ToolError("Отказ: install-dir является symlink/junction escape.", { exitCode: EXIT.ERROR });
    }
    const pkg = path.join(abs, "package.json");
    const ui = path.join(abs, "ui-dist", "index.html");
    if (fs.existsSync(pkg) && fs.existsSync(ui)) {
      throw new ToolError("Отказ: путь похож на пакет @paperclipai/server, а не на install root paperclip-ru.", {
        exitCode: EXIT.ERROR,
      });
    }
  }

  return abs;
}

export function defaultInstallDir() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "paperclip-ru");
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "paperclip-ru");
}
