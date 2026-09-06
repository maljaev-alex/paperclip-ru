import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const LOCALES_DIR = path.join(PROJECT_ROOT, "locales");
export const WORK_OUT_DIR = path.join(PROJECT_ROOT, "work");

/**
 * Provenance / load order of the effective exact dictionary:
 * ru.bulk.json -> ru.catalog.json -> ru.manual.json -> ru.json
 * Then no-exact.json removes context-sensitive keys. ru.rules.json is fallback.
 * ru.json is the manual-override source of truth and always wins.
 */
export const EXACT_LAYER_ORDER = ["ru.bulk.json", "ru.catalog.json", "ru.manual.json", "ru.json"];

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

export function loadDictionary() {
  const exact = new Map();
  const layers = [];

  for (const name of EXACT_LAYER_ORDER) {
    const file = path.join(LOCALES_DIR, name);
    const data = readJson(file, {});
    let added = 0;
    for (const [en, ru] of Object.entries(data)) {
      if (typeof ru !== "string" || !ru) continue;
      if (ru === en) continue;
      if (en === "_comment") continue;
      exact.set(en, ru);
      added += 1;
    }
    layers.push({ file: name, entries: added });
  }

  const noExact = readJson(path.join(LOCALES_DIR, "no-exact.json"), []);
  for (const en of noExact) exact.delete(en);

  const rulesRaw = readJson(path.join(LOCALES_DIR, "ru.rules.json"), []);
  const rules = rulesRaw.map((r) => ({
    pattern: r.pattern,
    flags: r.flags ?? "",
    replace: r.replace,
    scope: r.scope ?? "any",
  }));

  const noStatic = new Set(readJson(path.join(LOCALES_DIR, "no-static.json"), []));

  const plurals = {};
  for (const [form, variants] of Object.entries(readJson(path.join(LOCALES_DIR, "ru.plurals.json"), {}))) {
    if (form.startsWith("_")) continue;
    if (Array.isArray(variants) && variants.length === 3) plurals[form] = variants;
  }

  const fingerprint = dictionaryFingerprint({ exact, rules, noStatic, plurals });
  return { exact, rules, noStatic, plurals, layers, noExact, fingerprint };
}

export function dictionaryFingerprint(dict) {
  const h = crypto.createHash("sha256");
  for (const [en, ru] of [...dict.exact].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    h.update(`${en}\u0000${ru}\u0001`);
  }
  h.update(JSON.stringify(dict.rules));
  h.update([...dict.noStatic].sort().join("\u0000"));
  h.update(JSON.stringify(dict.plurals ?? {}));
  return h.digest("hex");
}

export function dictionaryStats(dict) {
  return {
    entries: dict.exact.size,
    rules: dict.rules.length,
    noStatic: dict.noStatic.size,
    plurals: Object.keys(dict.plurals || {}).length,
    fingerprint: dict.fingerprint,
  };
}
