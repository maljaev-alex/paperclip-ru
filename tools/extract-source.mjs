#!/usr/bin/env node
/**
 * Extracts user-facing strings straight from the Paperclip UI sources.
 *
 * The shipped bundle mixes application text with vendor code, so scanning the
 * TypeScript/TSX sources of a matching release tag gives a far cleaner list and
 * keeps the originating file as translation context.
 *
 * Usage: node tools/extract-source.mjs <path to paperclip repo checkout> [outFile]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repo = process.argv[2];
const outFile = process.argv[3] || path.resolve("work/source-strings.json");
if (!repo) {
  console.error("Укажите путь к checkout репозитория paperclip");
  process.exit(1);
}

const SCAN_DIRS = [
  { dir: path.join(repo, "ui", "src"), area: "ui" },
  { dir: path.join(repo, "server", "src"), area: "server" },
  { dir: path.join(repo, "packages"), area: "packages" },
];

const SKIP_SEGMENTS = [
  "__tests__", "__mocks__", "fixtures", "storybook", "node_modules", "dist", "i18n",
];
const SKIP_FILE = /\.(test|spec|stories|d)\.[cm]?tsx?$/;

const UI_ATTRS = new Set([
  "actionLabel", "addLabel", "alt", "aria-description", "aria-label", "aria-placeholder",
  "aria-roledescription", "aria-valuetext", "badgeLabel", "buttonLabel", "cancelLabel", "caption",
  "confirmLabel", "cta", "ctaLabel", "description", "detail", "dialogTitle", "emptyDescription",
  "emptyHint", "emptyLabel", "emptyMessage", "emptyState", "emptyText", "emptyTitle", "error",
  "errorMessage", "fallback", "footer", "header", "heading", "helper", "helperText", "hint",
  "label", "loadingLabel", "loadingText", "message", "note", "placeholder", "primaryLabel",
  "prompt", "removeLabel", "searchPlaceholder", "secondaryLabel", "srLabel", "subheading",
  "submitLabel", "subtitle", "summary", "text", "title", "tooltip", "warning",
]);

const UI_PROPS = new Set([
  ...UI_ATTRS,
  "body", "blurb", "children", "content", "copy", "descriptionText", "details", "displayName",
  "explanation", "headline", "instructions", "labelText", "lead", "legend", "name", "question",
  "reason", "sectionTitle", "shortDescription", "subLabel", "successMessage", "tagline",
  "toastMessage", "whenToUse",
]);

const CALL_TEXT_ARG = new Set([
  "toast", "success", "error", "warning", "info", "loading", "confirm", "alert", "notify",
  "showToast", "pushToast",
]);

function walkFiles(dir, area, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_SEGMENTS.includes(entry.name)) continue;
      walkFiles(full, area, out);
    } else if (/\.[cm]?tsx?$/.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      out.push({ file: full, area });
    }
  }
}

/** Reproduces the JSX whitespace collapsing performed by the compiler. */
function normalizeJsxText(raw) {
  const lines = raw.split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    if (!isFirst) line = line.replace(/^[ \t]+/, "");
    if (!isLast) line = line.replace(/[ \t]+$/, "");
    if (line.length === 0 && !isFirst && !isLast) continue;
    if (line.trim().length === 0 && (isFirst || isLast) && lines.length > 1) continue;
    kept.push(line);
  }
  return kept.join(" ");
}

const results = new Map();

function record(value, meta) {
  const text = value;
  if (!text) return;
  const trimmed = text.trim();
  if (trimmed.length < 2) return;
  if (!/[A-Za-z]{2}/.test(trimmed)) return;
  const rec = results.get(trimmed) || { value: trimmed, count: 0, sources: new Set(), kinds: new Set() };
  rec.count += 1;
  rec.sources.add(meta.source);
  rec.kinds.add(meta.kind);
  results.set(trimmed, rec);
}

function propertyNameOf(node) {
  const name = node.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function nearestUiProp(node) {
  let cur = node.parent;
  let hops = 0;
  while (cur && hops < 6) {
    if (ts.isPropertyAssignment(cur)) return propertyNameOf(cur);
    if (ts.isJsxAttribute(cur)) return cur.name.getText();
    if (!ts.isArrayLiteralExpression(cur) && !ts.isConditionalExpression(cur) && !ts.isParenthesizedExpression(cur) && !ts.isBinaryExpression(cur)) {
      return null;
    }
    cur = cur.parent;
    hops += 1;
  }
  return null;
}

function isTypePosition(node) {
  let cur = node.parent;
  while (cur) {
    if (
      ts.isTypeAliasDeclaration(cur) || ts.isInterfaceDeclaration(cur) ||
      ts.isTypeLiteralNode(cur) || ts.isUnionTypeNode(cur) || ts.isLiteralTypeNode(cur) ||
      ts.isTypeReferenceNode(cur) || ts.isImportDeclaration(cur) || ts.isExportDeclaration(cur) ||
      ts.isEnumDeclaration(cur)
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function callTextArgument(node) {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;
  const expr = parent.expression;
  const name = ts.isPropertyAccessExpression(expr)
    ? expr.name.text
    : ts.isIdentifier(expr)
      ? expr.text
      : null;
  if (!name) return false;
  if (!CALL_TEXT_ARG.has(name)) return false;
  return parent.arguments[0] === node;
}

/** Broad net for UI files: any literal shaped like a human-readable phrase. */
function looksLikeProse(s) {
  const t = s.trim();
  if (t.length < 4 || t.length > 400) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|mailto:|data:|blob:|\.{0,2}\/)/i.test(t)) return false;
  if (/^[\w.-]+@[\w.-]+$/.test(t)) return false;
  if (/^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(t)) return false;
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(t)) return false;
  if (/^[A-Z0-9_]{2,}$/.test(t)) return false;
  if (/[<>{}\\|]/.test(t)) return false;
  if (/^\W/.test(t) && !/^["'(«]/.test(t)) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters / t.length < 0.5) return false;
  const words = t.split(/\s+/);
  if (words.length === 1) return /^[A-Z][a-z]{2,}$/.test(t);
  const classy = words.filter((w) => /-/.test(w) && /^[a-z[]/.test(w)).length;
  if (classy / words.length > 0.5) return false;
  if (/^[A-Z(«"']/.test(t) || /[.!?…]$/.test(t)) return true;
  // Lowercase multi-word phrases: activity feed fragments such as
  // "environment lease released" are written that way on purpose.
  return words.length >= 2 && words.every((w) => /^[a-z][a-z'’]*$/.test(w));
}

function scan(file, area) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(repo, file).replace(/\\/g, "/");

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const value = normalizeJsxText(node.text);
      if (value.trim()) record(value.trim(), { source: rel, kind: "jsx-text" });
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const attr = node.name.getText();
      const init = node.initializer;
      if (UI_ATTRS.has(attr)) {
        if (ts.isStringLiteral(init)) record(init.text, { source: rel, kind: `attr:${attr}` });
        else if (
          ts.isJsxExpression(init) && init.expression &&
          (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
        ) {
          record(init.expression.text, { source: rel, kind: `attr:${attr}` });
        }
      }
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isTypePosition(node)) {
      const prop = nearestUiProp(node);
      if (prop && UI_PROPS.has(prop)) {
        record(node.text, { source: rel, kind: `prop:${prop}` });
      } else if (callTextArgument(node)) {
        record(node.text, { source: rel, kind: "call-text" });
      } else if (area === "ui" && looksLikeProse(node.text)) {
        record(node.text, { source: rel, kind: "prose" });
      }
    } else if (ts.isTemplateExpression(node) && !isTypePosition(node)) {
      const prop = nearestUiProp(node);
      const inCall = callTextArgument(node);
      if ((prop && UI_PROPS.has(prop)) || inCall) {
        for (const span of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
          const chunk = span.text.trim();
          if (chunk.length >= 3 && /[A-Za-z]{2}/.test(chunk)) {
            record(chunk, { source: rel, kind: "template-chunk" });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
}

const files = [];
for (const { dir, area } of SCAN_DIRS) walkFiles(dir, area, files);
for (const { file, area } of files) {
  try {
    scan(file, area);
  } catch (err) {
    console.error(`skip ${file}: ${err.message}`);
  }
}

const list = [...results.values()]
  .map((r) => ({ value: r.value, count: r.count, kinds: [...r.kinds].sort(), sources: [...r.sources].sort().slice(0, 6) }))
  .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(list, null, 2));
console.log(`Файлов просканировано: ${files.length}`);
console.log(`Уникальных строк: ${list.length}`);
console.log(`Результат: ${outFile}`);
