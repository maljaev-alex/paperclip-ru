#!/usr/bin/env node
/**
 * Builds the translation worklist: takes the strings found in the UI sources,
 * keeps only those that really exist in the installed bundle, drops everything
 * already present in the dictionary, and splits the rest into review-sized
 * chunks grouped by feature area.
 *
 * Usage: node tools/prepare-translation.mjs [--chunk-size 400] [--wave 1] [--extra file.json]
 * Requires work/source-strings.json produced by tools/extract-source.mjs.
 *
 * `--extra` adds a plain array of strings that never appear as bundle literals
 * (server payloads, humanised event names) but still surface in the UI.
 */
import fs from "node:fs";
import path from "node:path";

import { findServerPackage, listTargets, workPaths } from "./lib/paths.mjs";
import { extractOccurrences } from "./lib/strings.mjs";
import { loadDictionary, WORK_OUT_DIR } from "./lib/dictionary.mjs";

const argv = process.argv.slice(2);
const chunkSize = Number(argv[argv.indexOf("--chunk-size") + 1]) || 400;
const wave = argv.includes("--wave") ? String(argv[argv.indexOf("--wave") + 1]) : "1";
const extraFiles = argv.reduce((acc, a, i) => (a === "--extra" ? [...acc, argv[i + 1]] : acc), []);

const server = findServerPackage();
const work = workPaths(server);
const dict = loadDictionary();

const sourceFile = path.join(WORK_OUT_DIR, "source-strings.json");
if (!fs.existsSync(sourceFile)) {
  console.error("Нет work/source-strings.json — сначала выполните tools/extract-source.mjs");
  process.exit(1);
}
const sourceStrings = JSON.parse(fs.readFileSync(sourceFile, "utf8"));

const bundle = new Map();
for (const rel of listTargets(server.uiDist).filter((t) => t.endsWith(".js"))) {
  const baselineFile = path.join(work.baseline, rel);
  const file = fs.existsSync(baselineFile) ? baselineFile : path.join(server.uiDist, rel);
  let occ;
  try {
    occ = extractOccurrences(fs.readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  for (const o of occ) {
    if (o.block) continue;
    bundle.set(o.value, (bundle.get(o.value) || 0) + 1);
  }
}

function areaOf(sources) {
  const s = sources[0] || "";
  let m = s.match(/^ui\/src\/(pages|components|adapters|lib|hooks|context|plugins|api)\/([^/]+)/);
  if (m) return `${m[1]}/${m[2].replace(/\.[tj]sx?$/, "")}`;
  m = s.match(/^ui\/src\/([^/]+)/);
  if (m) return `ui/${m[1].replace(/\.[tj]sx?$/, "")}`;
  m = s.match(/^(server|packages)\/([^/]+\/[^/]+)/);
  if (m) return `${m[1]}/${m[2]}`;
  return "other";
}

const todo = [];
for (const row of sourceStrings) {
  if (!bundle.has(row.value)) continue;
  if (dict.exact.has(row.value)) continue;
  todo.push({
    value: row.value,
    area: areaOf(row.sources),
    uses: bundle.get(row.value),
    source: row.sources[0] || "",
  });
}

for (const file of extraFiles) {
  const values = JSON.parse(fs.readFileSync(file, "utf8"));
  const area = `extra/${path.basename(file, ".json")}`;
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (dict.exact.has(value)) continue;
    if (todo.some((r) => r.value === value)) continue;
    todo.push({ value, area, uses: 0, source: file });
  }
}

const groups = new Map();
for (const row of todo) {
  if (!groups.has(row.area)) groups.set(row.area, []);
  groups.get(row.area).push(row);
}
const orderedAreas = [...groups.keys()].sort();

const chunks = [];
let current = [];
for (const area of orderedAreas) {
  const rows = groups.get(area).sort((a, b) => b.uses - a.uses || a.value.localeCompare(b.value));
  for (const row of rows) {
    current.push(row);
    if (current.length >= chunkSize) {
      chunks.push(current);
      current = [];
    }
  }
}
if (current.length) chunks.push(current);

// Chunk ids carry the wave tag so a later wave never reuses the file names of an
// earlier one — `merge-parts` pairs chunks with parts purely by name.
const chunkDir = path.join(WORK_OUT_DIR, "chunks");
fs.mkdirSync(chunkDir, { recursive: true });
for (const f of fs.readdirSync(chunkDir)) {
  if (f.startsWith(`chunk-w${wave}-`)) fs.rmSync(path.join(chunkDir, f));
}

chunks.forEach((rows, i) => {
  const id = `w${wave}-${String(i + 1).padStart(2, "0")}`;
  fs.writeFileSync(path.join(chunkDir, `chunk-${id}.json`), JSON.stringify(rows, null, 2));
});

fs.writeFileSync(path.join(WORK_OUT_DIR, "todo.json"), JSON.stringify(todo, null, 2));

console.log(`Paperclip ${server.version}`);
console.log(`Строк из исходников: ${sourceStrings.length}`);
console.log(`Есть в бандле и без перевода: ${todo.length}`);
console.log(`Блоков по ${chunkSize}: ${chunks.length} -> work/chunks/`);
