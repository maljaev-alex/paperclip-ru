import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, hashFile } from "./fs-atomic.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function fingerprintsPath() {
  return path.join(PROJECT_ROOT, "data", "fingerprints.json");
}

export function loadFingerprints() {
  const file = fingerprintsPath();
  if (!fs.existsSync(file)) {
    return { schema: "paperclip-ru-fingerprints/v1", versions: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { schema: "paperclip-ru-fingerprints/v1", versions: {} };
  }
}

export function fingerprintRecord(version, data = loadFingerprints()) {
  return data?.versions?.[version] ?? null;
}

export function computeUiDistFingerprint(uiDist, targets) {
  const files = {};
  for (const rel of [...targets].sort()) {
    const file = path.join(uiDist, rel);
    files[rel] = hashFile(file);
  }
  const digest = fingerprintFromFiles(files);
  return { fingerprint: digest, files, fileCount: Object.keys(files).length };
}

export function fingerprintFromFiles(files) {
  const parts = Object.keys(files)
    .sort()
    .map((rel) => `${rel}:${files[rel]}`);
  return sha256(Buffer.from(parts.join("\n")));
}

/**
 * First apply on a full-supported official bundle must match the stored
 * inventory. Extra or missing JS/HTML files, or hash mismatch, is unknown
 * modified content — not a valid baseline.
 */
export function matchFingerprint({ record, uiDist, targets }) {
  if (!record || !record.files) {
    return { ok: false, reason: "fingerprint-missing", mismatches: [] };
  }
  const expected = Object.keys(record.files).sort();
  const actual = [...targets].sort();
  const mismatches = [];
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const extra = actual.filter((f) => !record.files[f]);
    const missing = expected.filter((f) => !actual.includes(f));
    return {
      ok: false,
      reason: "inventory-mismatch",
      extra,
      missing,
      mismatches,
    };
  }
  for (const rel of expected) {
    const file = path.join(uiDist, rel);
    if (!fs.existsSync(file)) {
      mismatches.push({ file: rel, expected: record.files[rel], actual: null });
      continue;
    }
    const actualHash = hashFile(file);
    if (actualHash !== record.files[rel]) {
      mismatches.push({ file: rel, expected: record.files[rel], actual: actualHash });
    }
  }
  if (mismatches.length) {
    return { ok: false, reason: "hash-mismatch", mismatches };
  }
  const digest = fingerprintFromFiles(record.files);
  if (record.fingerprint && digest !== record.fingerprint) {
    return { ok: false, reason: "fingerprint-record-inconsistent", mismatches: [] };
  }
  return { ok: true, reason: null, mismatches: [], fingerprint: digest };
}
