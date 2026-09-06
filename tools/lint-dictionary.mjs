#!/usr/bin/env node
/**
 * Quality gate for the assembled dictionary.
 * Read-only by default. JSON report only with --report <path>.
 * --fix applies only mechanical whitespace/punctuation repairs.
 *
 * Usage: node tools/lint-dictionary.mjs [--fix] [--report <path>] [--json]
 */
import { lintDictionary, applySafeFixes } from "./lib/lint.mjs";

const argv = process.argv.slice(2);
const fix = argv.includes("--fix");
const json = argv.includes("--json");
const reportIdx = argv.indexOf("--report");
const reportPath = reportIdx >= 0 ? argv[reportIdx + 1] : null;

if (reportIdx >= 0 && (!reportPath || reportPath.startsWith("-"))) {
  console.error("Флаг --report требует путь.");
  process.exit(2);
}

const result = lintDictionary();
if (json) {
  console.log(JSON.stringify({ counts: result.counts, issues: result.issues }, null, 2));
} else {
  console.log(`error: ${result.counts.error}`);
  console.log(`warning: ${result.counts.warning}`);
  console.log(`info: ${result.counts.info}`);
  console.log(`Всего записей: ${result.counts.entries}`);
  for (const item of result.issues.error.slice(0, 20)) {
    console.log(`  E ${item.code}: ${item.message}`);
  }
  if (result.issues.error.length > 20) console.log(`  ... и ещё ${result.issues.error.length - 20} ошибок`);
}

if (reportPath) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  if (!json) console.log(`Отчёт: ${reportPath}`);
}

if (fix) {
  const n = applySafeFixes();
  if (!json) console.log(`Исправлено автоматически: ${n}`);
}

const baselineFile = new URL("../data/lint-warning-baseline.json", import.meta.url);
const baseline = JSON.parse((await import("node:fs")).readFileSync(baselineFile, "utf8"));
const byCode = {};
for (const item of result.issues.warning) {
  byCode[item.code] = (byCode[item.code] || 0) + 1;
}
const baselineDrift = [];
for (const [code, n] of Object.entries(byCode)) {
  const allowed = baseline.byCode?.[code];
  if (allowed == null) baselineDrift.push(`новый warning ${code} (${n})`);
  else if (n > allowed) baselineDrift.push(`${code}: ${n} > baseline ${allowed}`);
}
if (baselineDrift.length) {
  console.error(`lint warning baseline нарушен: ${baselineDrift.join("; ")}`);
  process.exitCode = 1;
}
if (result.counts.error > 0) process.exitCode = 1;
