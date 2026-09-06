#!/usr/bin/env node
/**
 * Pulls display text out of the markdown and catalog files shipped inside the
 * installed Paperclip packages: skill names and descriptions, routine titles,
 * catalog entries. The UI renders these as data, so they need dictionary
 * entries even though they never appear in the browser bundle.
 *
 * Only YAML frontmatter fields are read. Markdown bodies are agent prompts and
 * are deliberately left in English.
 *
 * Usage: node tools/extract-installed-md.mjs [outFile]
 */
import fs from "node:fs";
import path from "node:path";

import { findServerPackage } from "./lib/paths.mjs";

const outFile = process.argv[2] || path.resolve("work/installed-strings.json");
const server = findServerPackage();
const scope = path.dirname(server.dir); // …/node_modules/@paperclipai

const FRONTMATTER_FIELDS = new Set(["name", "title", "description", "summary", "label"]);
const MD_NAMES = /^(SKILL|TEAM|PROJECT|TASK)\.md$/i;
const ROUTINE_DIR = /[\\/]routines[\\/]/;
const SKIP_DIRS = new Set(["node_modules", "references", "assets", "test", "__tests__"]);

const found = new Map();

function record(value, source) {
  const t = String(value).trim().replace(/^["']|["']$/g, "");
  if (t.length < 3 || t.length > 400) return;
  if (!/[A-Za-z]{2}/.test(t)) return;
  if (/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(t)) return; // slug identifiers
  if (!found.has(t)) found.set(t, source);
}

function readFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return;
  const rel = path.relative(scope, file).replace(/\\/g, "/");
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, inline] = kv;
    if (!FRONTMATTER_FIELDS.has(key)) continue;

    // Folded/literal block scalars ("description: >") carry the long skill
    // descriptions; the UI shows them folded into a single paragraph.
    if (/^[|>][-+]?$/.test(inline.trim())) {
      const block = [];
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j += 1) block.push(lines[j].trim());
      i += block.length;
      record(block.join(" ").replace(/\s+/g, " "), rel);
      continue;
    }
    if (inline.trim()) record(inline, rel);
  }
}

function readCatalogJson(file) {
  const rel = path.relative(scope, file).replace(/\\/g, "/");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const visit = (value, key) => {
    if (typeof value === "string") {
      if (key && FRONTMATTER_FIELDS.has(key)) record(value, rel);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v) => visit(v, key));
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(data, null);
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full);
    } else if (MD_NAMES.test(e.name) || (e.name.endsWith(".md") && ROUTINE_DIR.test(full))) {
      readFrontmatter(full);
    } else if (e.name === "catalog.json") {
      readCatalogJson(full);
    }
  }
}

walk(scope);

const list = [...found.keys()].sort((a, b) => a.localeCompare(b));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(list, null, 2));
console.log(`Каталог пакетов: ${scope}`);
console.log(`Строк-данных из установленных пакетов: ${list.length}`);
console.log(`Результат: ${outFile}`);
