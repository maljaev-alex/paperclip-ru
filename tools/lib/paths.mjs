import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EXIT, WORK_DIR_NAME } from "./constants.mjs";
import { ToolError } from "./fs-atomic.mjs";

const SERVER_PKG = "@paperclipai/server";
const SERVER_SEGMENTS = ["@paperclipai", "server"];

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function loadServerAt(dir) {
  const pkgFile = path.join(dir, "package.json");
  const uiDist = path.join(dir, "ui-dist");
  if (!fs.existsSync(pkgFile) || !fs.existsSync(path.join(uiDist, "index.html"))) {
    return null;
  }
  const pkg = readJsonSafe(pkgFile) || {};
  let writable = false;
  try {
    fs.accessSync(uiDist, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  return {
    dir: path.resolve(dir),
    uiDist: path.resolve(uiDist),
    name: pkg.name || SERVER_PKG,
    version: pkg.version || "unknown",
    writable,
  };
}

function npmOption(env, name) {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === `npm_config_${name}`);
  return entry?.[1] || null;
}

function prefixFromConfig(file, env, home) {
  if (!file) return null;
  try {
    let prefix = null;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*prefix\s*=\s*(.*?)\s*$/i);
      if (!match) continue;
      const raw = match[1].replace(/\s+[;#].*$/, "").replace(/^(["'])(.*)\1$/, "$2");
      prefix = raw.replace(/\$\{([^}]+)\}/g, (_, key) => env[key] ?? "").replace(/^~(?=[/\\]|$)/, home || "~");
    }
    return prefix;
  } catch { return null; }
}

export function candidateRoots({ env = process.env, platform = process.platform, execPath = process.execPath } = {}) {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const dirname = platform === "win32" ? path.win32.dirname : path.posix.dirname;
  const roots = [];
  const push = (p) => {
    if (p && !roots.includes(p)) roots.push(p);
  };

  if (env.PAPERCLIP_SERVER_DIR) push(env.PAPERCLIP_SERVER_DIR);

  const npmRoots = [];
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const runtimePrefix = platform === "win32" ? dirname(execPath) : dirname(dirname(execPath));
  // npm root -g itself creates cache/log directories and may clean old logs.
  // Read only prefix settings; never run npm in diagnostic or dry-run discovery.
  const prefixes = [
    npmOption(env, "prefix"),
    prefixFromConfig(npmOption(env, "userconfig") || (home && join(home, ".npmrc")), env, home),
    prefixFromConfig(npmOption(env, "globalconfig") || join(runtimePrefix, "etc", "npmrc"), env, home),
    env.PREFIX,
    runtimePrefix,
  ].filter(Boolean);
  for (const prefix of prefixes) npmRoots.push(platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules"));
  if (env.APPDATA) npmRoots.push(join(env.APPDATA, "npm", "node_modules"));
  npmRoots.push("/usr/local/lib/node_modules", "/usr/lib/node_modules");
  if (home) {
    npmRoots.push(join(home, ".npm-global", "lib", "node_modules"));
    npmRoots.push(join(home, ".local", "share", "npm", "lib", "node_modules"));
    npmRoots.push(join(home, ".paperclip", "cli", "node_modules"));
  }

  for (const root of npmRoots) {
    push(join(root, "paperclipai", "node_modules", ...SERVER_SEGMENTS));
    push(join(root, ...SERVER_SEGMENTS));
  }
  return roots;
}

/**
 * Locates @paperclipai/server. `--server-dir` wins over env and autodiscovery.
 */
export function findServerPackage({ serverDir, env = process.env, platform = process.platform } = {}) {
  if (serverDir) {
    const found = loadServerAt(serverDir);
    if (!found) {
      throw new ToolError(
        `Не найден @paperclipai/server с ui-dist по пути --server-dir: ${serverDir}`,
        { exitCode: EXIT.NOT_FOUND, nextAction: "none" }
      );
    }
    return found;
  }

  if (env.PAPERCLIP_SERVER_DIR) {
    const found = loadServerAt(env.PAPERCLIP_SERVER_DIR);
    if (found) return found;
  }

  for (const dir of candidateRoots({ env, platform })) {
    const found = loadServerAt(dir);
    if (found) return found;
  }

  throw new ToolError(
    [
      "Не найден установленный пакет @paperclipai/server с каталогом ui-dist.",
      "Проверьте, что Paperclip установлен (npm ls -g paperclipai),",
      "либо укажите путь: --server-dir <путь к @paperclipai/server>",
      "или PAPERCLIP_SERVER_DIR.",
    ].join(" "),
    { exitCode: EXIT.NOT_FOUND, nextAction: "none" }
  );
}

export function workPaths(server) {
  const root = path.join(server.uiDist, WORK_DIR_NAME);
  return {
    root,
    baseline: path.join(root, "baseline"),
    manifest: path.join(root, "manifest.json"),
    journal: path.join(root, "journal.json"),
    staging: path.join(root, "staging"),
    tmp: path.join(root, "tmp"),
  };
}

/** UI asset files the translator may touch, relative to ui-dist, posix separators. */
export function listTargets(uiDist) {
  const targets = [];
  const assetsDir = path.join(uiDist, "assets");
  if (fs.existsSync(assetsDir)) {
    for (const name of fs.readdirSync(assetsDir).sort()) {
      if (name.endsWith(".js") && !name.startsWith("paperclip-ru")) {
        targets.push(path.posix.join("assets", name));
      }
    }
  }
  if (fs.existsSync(path.join(uiDist, "index.html"))) targets.push("index.html");
  return targets;
}

export { SERVER_PKG, loadServerAt, readJsonSafe };
