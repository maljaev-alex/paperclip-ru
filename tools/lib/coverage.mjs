import fs from "node:fs";
import path from "node:path";
import { loadDictionary, dictionaryStats } from "./dictionary.mjs";
import { findServerPackage, listTargets, workPaths } from "./paths.mjs";
import { extractOccurrences, looksLikeUiText, plausibleLabel, UI_KEYS } from "./strings.mjs";
import { PROJECT_ROOT } from "./dictionary.mjs";
import { readJson } from "./fs-atomic.mjs";

const LIBRARY_NOISE = /(mermaid|lexical|codemirror|monaco|shiki|prism|highlight\.js|katex|d3-|plotly|mapbox)/i;

/**
 * A sibling group is a propKey whose values are mostly translated. Remaining
 * complete operator sentences in that group are unfinished localization, not
 * vendor noise. Fragments, mermaid names and recorded exceptions stay out.
 */
export function analyzePartialSiblingGroups(records, dict, exceptions = [], { minShare = 0.6, minTranslated = 2 } = {}) {
  const exceptKeys = new Set(exceptions.filter((e) => e.propKey && !e.key).map((e) => e.propKey));
  const exceptValues = new Set(exceptions.map((e) => e.key).filter(Boolean));
  const byKey = new Map();
  for (const rec of records) {
    const key = rec.propKey;
    if (!key || exceptKeys.has(key)) continue;
    const g = byKey.get(key) || { propKey: key, translated: [], missing: [] };
    const covered = dict.exact.has(rec.value) || coveredByRule(rec.value, dict.rules || []);
    (covered ? g.translated : g.missing).push(rec.value);
    byKey.set(key, g);
  }
  const groups = [];
  for (const g of byKey.values()) {
    const uniqueMissing = [...new Set(g.missing)].filter((value) => !exceptValues.has(value));
    const uniqueTranslated = [...new Set(g.translated)];
    if (uniqueTranslated.length < minTranslated || !uniqueMissing.length) continue;
    const operatorMissing = uniqueMissing.filter(isOperatorSentence);
    if (!operatorMissing.length) continue;
    const translatedShare = uniqueTranslated.length / (uniqueTranslated.length + uniqueMissing.length);
    if (translatedShare < minShare) continue;
    groups.push({
      propKey: g.propKey,
      translatedCount: uniqueTranslated.length,
      missingCount: uniqueMissing.length,
      translatedShare: Number(translatedShare.toFixed(2)),
      missing: operatorMissing,
    });
  }
  return groups.sort((a, b) => b.translatedShare - a.translatedShare || a.propKey.localeCompare(b.propKey));
}

function isOperatorSentence(value) {
  const s = String(value).trim();
  if (s.length < 18) return false;
  if (!/[A-Za-z]{3}/.test(s) || !/\s/.test(s)) return false;
  if (/^(https?:|mailto:)/i.test(s)) return false;
  return looksLikeUiText(s) || /^[A-Z][\s\S]+[.!?…]$/.test(s);
}

export function buildCoverageReport({ serverDir, routeMatrix } = {}) {
  const dict = loadDictionary();
  const stats = dictionaryStats(dict);
  const exceptions = readJson(path.join(PROJECT_ROOT, "locales", "coverage-exceptions.json"), []);

  let classifiedUi = 0;
  let translatedExact = 0;
  let uncoveredUi = 0;
  let libraryNoise = 0;
  const siblingRecords = [];

  let server = null;
  try {
    server = findServerPackage({ serverDir });
  } catch {
    server = null;
  }

  if (server) {
    const work = workPaths(server);
    const targets = listTargets(server.uiDist).filter((t) => t.endsWith(".js"));
    for (const rel of targets) {
      const baseline = path.join(work.baseline, rel);
      const file = fs.existsSync(baseline) ? baseline : path.join(server.uiDist, rel);
      let occurrences;
      try {
        occurrences = extractOccurrences(fs.readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      for (const occ of occurrences) {
        if (occ.block) continue;
        const ui = looksLikeUiText(occ.value) || (UI_KEYS.has(occ.propKey) && plausibleLabel(occ.value));
        if (!ui) continue;
        if (LIBRARY_NOISE.test(occ.value) || LIBRARY_NOISE.test(rel)) {
          libraryNoise += 1;
          continue;
        }
        classifiedUi += 1;
        siblingRecords.push({ value: occ.value, propKey: occ.propKey });
        if (dict.exact.has(occ.value)) translatedExact += 1;
        else if (coveredByRule(occ.value, dict.rules)) translatedExact += 1;
        else uncoveredUi += 1;
      }
    }
  }
  const partialGroups = analyzePartialSiblingGroups(siblingRecords, dict, exceptions);

  const allowedExceptions = exceptions.map((e) => ({
    key: e.key,
    category: e.category,
    reason: e.reason,
  }));

  const report = {
    paperclipVersion: server?.version ?? null,
    dictionaryEntries: stats.entries,
    rules: stats.rules,
    plurals: stats.plurals,
    classifiedUiStrings: classifiedUi,
    translatedExact,
    coveredScopedRegex: dict.rules.filter((r) => r.scope && r.scope !== "any").length,
    allowedExceptions: allowedExceptions.length,
    exceptions: allowedExceptions,
    libraryNoise,
    uncoveredUi,
    partialGroups,
    provenance: null,
    timestamp: null,
    routes: null,
    errors: null,
    runtimeLeaks: null,
    dynamicOrUnverifiable: null,
    note: "Покрытие считается по классифицированным UI-литералам бандла, а не по размеру словаря. Поля dynamicOrUnverifiable/runtimeLeaks включаются только при переданной route-matrix.",
  };

  if (routeMatrix) {
    if (!fs.existsSync(routeMatrix)) {
      throw new Error(`route-matrix не найден: ${routeMatrix}`);
    }
    const raw = readJson(routeMatrix, null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("route-matrix: ожидается JSON-объект");
    }
    if (
      raw.schema !== "paperclip-ru-route-matrix/v1"
      || !raw.provenance
      || typeof raw.provenance !== "object"
      || typeof raw.provenance.synthetic !== "boolean"
      || !raw.timestamp
      || !raw.paperclipVersion
      || !Array.isArray(raw.routes)
      || !raw.routes.length
      || !Array.isArray(raw.errors)
      || !Array.isArray(raw.runtimeLeaks)
    ) {
      throw new Error("route-matrix: неполная schema (нужны schema, provenance, provenance.synthetic, timestamp, routes, errors, runtimeLeaks)");
    }
    if (raw.errors.length || raw.runtimeLeaks.length) {
      throw new Error("route-matrix: errors/runtimeLeaks должны быть пустыми");
    }
    report.provenance = {
      ...raw.provenance,
      file: path.resolve(routeMatrix),
      paperclipVersion: raw.paperclipVersion ?? server?.version ?? raw.provenance.paperclipVersion ?? null,
      timestamp: raw.timestamp ?? raw.provenance.timestamp ?? null,
    };
    report.timestamp = raw.timestamp ?? null;
    report.routes = raw.routes;
    report.errors = raw.errors;
    report.runtimeLeaks = raw.runtimeLeaks;
    report.dynamicOrUnverifiable = Array.isArray(raw.dynamicOrUnverifiable) ? raw.dynamicOrUnverifiable : [];
  }
  return report;
}

function coveredByRule(value, rules) {
  for (const r of rules) {
    try {
      const re = new RegExp(r.pattern, r.flags || "");
      if (re.test(value)) return true;
    } catch {
      continue;
    }
  }
  return false;
}
