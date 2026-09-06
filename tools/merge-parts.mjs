#!/usr/bin/env node
/**
 * Turns the index-keyed translation parts produced for each work chunk into the
 * consolidated dictionary `locales/ru.bulk.json`, validating every entry along
 * the way. Entries that only differ by edge whitespace are repaired instead of
 * rejected, because that is by far the most common transcription slip.
 *
 * Usage: node tools/merge-parts.mjs [--strict] [--check]
 */
import fs from "node:fs";
import path from "node:path";

import { LOCALES_DIR, WORK_OUT_DIR } from "./lib/dictionary.mjs";

const strict = process.argv.includes("--strict");
const checkOnly = process.argv.includes("--check");
const chunkDir = path.join(WORK_OUT_DIR, "chunks");
const partsDir = path.join(LOCALES_DIR, "parts");
const outFile = path.join(LOCALES_DIR, "ru.bulk.json");

const PLACEHOLDER = /(\{\{[^}]+\}\}|\{\d+\}|%[sd]|\$\d)/g;

function serializeBulk(mapOrObject) {
  const entries =
    mapOrObject instanceof Map ? [...mapOrObject.entries()] : Object.entries(mapOrObject);
  const sorted = Object.fromEntries(entries.sort((a, b) => a[0].localeCompare(b[0])));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

if (checkOnly) {
  if (!fs.existsSync(outFile)) {
    console.error("Нет locales/ru.bulk.json");
    process.exit(1);
  }
  const current = fs.readFileSync(outFile, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(current);
  const expected = serializeBulk(parsed);
  if (current.replace(/\r\n/g, "\n") !== expected) {
    console.error("locales/ru.bulk.json не детерминирован: повторная сериализация даёт diff. Запустите node tools/merge-parts.mjs --normalize");
    process.exit(1);
  }
  console.log("locales/ru.bulk.json: детерминированная сериализация совпадает.");
  process.exit(0);
}

if (process.argv.includes("--normalize")) {
  if (!fs.existsSync(outFile)) {
    console.error("Нет locales/ru.bulk.json");
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(outFile, "utf8").replace(/^\uFEFF/, ""));
  fs.writeFileSync(outFile, serializeBulk(parsed));
  console.log(`Нормализован ${outFile}`);
  process.exit(0);
}

if (!fs.existsSync(chunkDir)) {
  console.error("Нет work/chunks — сначала выполните tools/prepare-translation.mjs");
  process.exit(1);
}

// Additive: each wave of chunks appends to the dictionary built by earlier waves.
const merged = new Map();
if (fs.existsSync(outFile)) {
  for (const [en, ru] of Object.entries(JSON.parse(fs.readFileSync(outFile, "utf8")))) merged.set(en, ru);
}
const carriedOver = merged.size;
const thisRun = new Set();
const problems = [];
const stats = { files: 0, entries: 0, fixedSpace: 0, skipped: 0, missingParts: [] };

for (const chunkName of fs.readdirSync(chunkDir).filter((f) => f.endsWith(".json")).sort()) {
  const id = chunkName.replace(/^chunk-|\.json$/g, "");
  const partFile = path.join(partsDir, `ru.chunk-${id}.json`);
  if (!fs.existsSync(partFile)) {
    stats.missingParts.push(chunkName);
    continue;
  }

  const rows = JSON.parse(fs.readFileSync(path.join(chunkDir, chunkName), "utf8"));
  let part;
  try {
    part = JSON.parse(fs.readFileSync(partFile, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    problems.push(`${path.basename(partFile)}: не разбирается как JSON — ${err.message}`);
    continue;
  }
  if (!Array.isArray(part)) {
    problems.push(`${path.basename(partFile)}: ожидался массив`);
    continue;
  }
  stats.files += 1;

  const seen = new Set();
  for (const item of part) {
    const i = item?.i;
    const ru = item?.ru;
    if (!Number.isInteger(i) || i < 0 || i >= rows.length) {
      problems.push(`${path.basename(partFile)}: индекс вне диапазона (${JSON.stringify(i)})`);
      continue;
    }
    if (seen.has(i)) {
      problems.push(`${path.basename(partFile)}: индекс ${i} повторяется`);
      continue;
    }
    seen.add(i);
    if (typeof ru !== "string" || !ru.trim()) {
      problems.push(`${path.basename(partFile)}: пустой перевод для индекса ${i}`);
      continue;
    }

    const en = rows[i].value;
    if (ru === en) {
      stats.skipped += 1;
      continue;
    }

    const lead = en.match(/^\s*/)[0];
    const tail = en.match(/\s*$/)[0];
    let value = ru;
    if (value.match(/^\s*/)[0] !== lead || value.match(/\s*$/)[0] !== tail) {
      value = lead + value.trim() + tail;
      stats.fixedSpace += 1;
    }

    const enTokens = (en.match(PLACEHOLDER) || []).sort();
    const ruTokens = (value.match(PLACEHOLDER) || []).sort();
    if (enTokens.join("|") !== ruTokens.join("|")) {
      problems.push(
        `${path.basename(partFile)}[${i}]: не совпадают плейсхолдеры ${JSON.stringify(en)} -> ${JSON.stringify(value)}`
      );
      continue;
    }

    if (thisRun.has(en) && merged.get(en) !== value) {
      problems.push(`конфликт перевода для ${JSON.stringify(en)}: ${JSON.stringify(merged.get(en))} / ${JSON.stringify(value)}`);
    }
    merged.set(en, value);
    thisRun.add(en);
    stats.entries += 1;
  }
}

fs.writeFileSync(outFile, serializeBulk(merged));

console.log(`Файлов частей: ${stats.files}`);
console.log(`Перенесено из прошлых волн: ${carriedOver}`);
console.log(`Добавлено в этой волне: ${stats.entries}`);
console.log(`Записей в словаре: ${merged.size}`);
console.log(`Исправлено краевых пробелов: ${stats.fixedSpace}`);
console.log(`Пропущено (перевод совпал с оригиналом): ${stats.skipped}`);
if (stats.missingParts.length) console.log(`Нет перевода для блоков: ${stats.missingParts.join(", ")}`);
if (problems.length) {
  console.log(`\nПроблемы (${problems.length}):`);
  for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  if (problems.length > 40) console.log(`  ... и ещё ${problems.length - 40}`);
  fs.writeFileSync(path.join(WORK_OUT_DIR, "merge-problems.json"), JSON.stringify(problems, null, 2));
}
if (strict && (problems.length || stats.missingParts.length)) process.exitCode = 1;
console.log(`\nРезультат: ${outFile}`);
