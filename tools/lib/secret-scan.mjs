import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const PATH_RE = /\b[A-Za-z]:\\(?:Users|Temp|Scripts|Windows)\\[^\s"'`]+/g;
const POSIX_HOME_RE = /\/(?:home|Users)\/[A-Za-z0-9._-]+\//g;
const SECRET_RE = /(-----BEGIN (?:RSA |OPENSSH |SECRET )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/;
const PII_RE = /(\bИНН\b|\bОГРН\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

const TEXT_EXT = new Set([".mjs", ".js", ".json", ".md", ".ps1", ".sh", ".yml", ".yaml", ".svg", ".txt", ".html", ".css"]);

function normalizeForScan(text, file) {
  if (path.resolve(file) === path.resolve(SELF)) {
    return text
      .replace(/const PATH_RE[\s\S]*?;/, "")
      .replace(/const POSIX_HOME_RE[\s\S]*?;/, "")
      .replace(/const SECRET_RE[\s\S]*?;/, "")
      .replace(/const PII_RE[\s\S]*?;/, "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "");
  }
  if (path.basename(file) === "SECURITY.md") {
    return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "");
  }
  return text;
}

export function scanText(text, file) {
  const hits = [];
  const piiText = normalizeForScan(text, file);
  if (SECRET_RE.test(piiText)) hits.push({ file, kind: "secret", message: "возможный секрет" });
  if (PII_RE.test(piiText)) hits.push({ file, kind: "pii", message: "персональные данные" });
  const paths = piiText.match(PATH_RE) || [];
  const homes = piiText.match(POSIX_HOME_RE) || [];
  for (const p of [...paths, ...homes]) {
    hits.push({ file, kind: "abspath", message: "абсолютный локальный путь" });
  }
  return hits;
}

export function scanTree(root, { extraIgnore = [] } = {}) {
  const hits = [];
  const ignore = new Set(["node_modules", ".git", "dist", "work", extraIgnore].flat());
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignore.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_EXT.has(ext) && ent.name !== "SHA256SUMS") continue;
      let text;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        continue;
      }
      hits.push(...scanText(text, path.relative(root, p).replaceAll("\\", "/")));
    }
  };
  walk(root);
  return hits;
}

export function scanTracked(root) {
  let files = [];
  try {
    files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  } catch {
    return scanTree(root);
  }
  const hits = [];
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!TEXT_EXT.has(ext) && path.basename(rel) !== "SHA256SUMS") continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    hits.push(...scanText(fs.readFileSync(abs, "utf8"), rel.replaceAll("\\", "/")));
  }
  return hits;
}

export function assertCleanScan(root) {
  const hits = fs.existsSync(path.join(root, ".git")) ? scanTracked(root) : scanTree(root);
  if (hits.length) {
    const summary = hits.slice(0, 20).map((h) => `${h.file}:${h.kind}`).join("; ");
    throw new Error(`scan: найдены PII/секреты/абсолютные пути (${hits.length}): ${summary}`);
  }
}
