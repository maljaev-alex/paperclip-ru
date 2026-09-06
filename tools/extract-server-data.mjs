#!/usr/bin/env node
/**
 * Collects the English text that Paperclip serves as *data* rather than as UI
 * bundle literals: catalog entries, built-in agent metadata, app definitions,
 * feature flags, attention reasons, recovery notices.
 *
 * These never appear as string literals in the browser bundle, so the static
 * patcher cannot reach them — they are translated at runtime by the overlay,
 * which needs them in the dictionary.
 *
 * Agent instructions (AGENTS.md, SOUL.md, SKILL.md bodies) are deliberately
 * excluded: they are prompts consumed by the models, and translating them would
 * change agent behaviour.
 *
 * Usage: node tools/extract-server-data.mjs <path to paperclip repo> [outFile]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repo = process.argv[2];
const outFile = process.argv[3] || path.resolve("work/server-strings.json");
if (!repo) {
  console.error("Укажите путь к checkout репозитория paperclip");
  process.exit(1);
}

const TS_ROOTS = [
  "server/src/services",
  "server/src/routes",
  "packages/shared/src",
  "packages/adapters",
  "packages/plugins",
];

const JSON_FILES = [
  "packages/teams-catalog/generated/catalog.json",
  "packages/skills-catalog/generated/catalog.json",
];

const JSON_GLOB_DIRS = ["packages/shared/src/app-definitions"];

const DISPLAY_PROPS = new Set([
  "blurb", "buttonLabel", "caption", "defaultRole", "defaultTitle", "description",
  "detail", "displayName", "emptyLabel", "helperText", "hint", "label", "message",
  "name", "note", "placeholder", "purpose", "reason", "shortDescription",
  "shortPurpose", "subtitle", "summary", "title", "tooltip", "whenToUse", "whyNow",
]);

const SKIP_SEGMENTS = ["__tests__", "__mocks__", "fixtures", "node_modules", "dist", "templates", "examples"];
const SKIP_FILE = /\.(test|spec|stories|d)\.[cm]?tsx?$/;

const found = new Map();

/** Identifiers, slugs and code fragments masquerading as display text. */
function isDisplayText(s) {
  const t = s.trim();
  if (t.length < 3 || t.length > 400) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|mailto:|data:|blob:|\.{0,2}\/|~\/)/i.test(t)) return false;
  if (/^[a-z0-9]+([._:-][a-z0-9]+)+$/i.test(t)) return false; // slug / dotted key
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(t)) return false; // camelCase
  if (/^[A-Z0-9_]{2,}$/.test(t)) return false; // CONST_CASE
  if (/[<>{}\\|`]/.test(t)) return false;
  if (/^\s*[#*-]\s/.test(t)) return false; // markdown fragment
  if (/\n/.test(t)) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters / t.length < 0.55) return false;
  const words = t.split(/\s+/);
  if (words.length === 1) return /^[A-Z][A-Za-z]{2,}$/.test(t) && !/^[A-Z]{2,}$/.test(t);
  return true;
}

function record(value, source) {
  const t = String(value).trim();
  if (!isDisplayText(t)) return;
  if (!found.has(t)) found.set(t, source);
}

function walkTs(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_SEGMENTS.includes(e.name)) continue;
      walkTs(full, out);
    } else if (/\.[cm]?tsx?$/.test(e.name) && !SKIP_FILE.test(e.name)) {
      out.push(full);
    }
  }
}

function propertyNameOf(node) {
  const name = node.name;
  if (!name) return null;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function scanTs(file) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(repo, file).replace(/\\/g, "/");

  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const key = propertyNameOf(node);
      if (key && DISPLAY_PROPS.has(key)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
          record(init.text, rel);
        } else if (ts.isArrayLiteralExpression(init)) {
          for (const el of init.elements) {
            if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) record(el.text, rel);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function scanJsonValue(value, key, source) {
  if (typeof value === "string") {
    if (key && DISPLAY_PROPS.has(key)) record(value, source);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) scanJsonValue(v, key, source);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) scanJsonValue(v, k, source);
  }
}

const tsFiles = [];
for (const root of TS_ROOTS) walkTs(path.join(repo, root), tsFiles);
for (const file of tsFiles) {
  try {
    scanTs(file);
  } catch (err) {
    console.error(`skip ${file}: ${err.message}`);
  }
}

const jsonFiles = [...JSON_FILES.map((f) => path.join(repo, f))];
for (const dir of JSON_GLOB_DIRS) {
  const full = path.join(repo, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) if (f.endsWith(".json")) jsonFiles.push(path.join(full, f));
}
for (const file of jsonFiles) {
  if (!fs.existsSync(file)) continue;
  const rel = path.relative(repo, file).replace(/\\/g, "/");
  try {
    scanJsonValue(JSON.parse(fs.readFileSync(file, "utf8")), null, rel);
  } catch (err) {
    console.error(`skip ${file}: ${err.message}`);
  }
}

const list = [...found.keys()].sort((a, b) => a.localeCompare(b));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(list, null, 2));
console.log(`TS-файлов: ${tsFiles.length}, JSON-файлов: ${jsonFiles.length}`);
console.log(`Строк-данных: ${list.length}`);
console.log(`Результат: ${outFile}`);
