import fs from "node:fs";
import path from "node:path";
import {
  FEATURE_PANEL_RESIZE,
  FEATURE_TRANSLATION,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMAS_SUPPORTED,
  OVERLAY_FILE,
  TOOL_NAME,
  TOOL_VERSION,
} from "./constants.mjs";
import { readText, sha256 } from "./fs-atomic.mjs";

export const MANIFEST_ABSENT = "absent";
export const MANIFEST_VALID = "valid";
export const MANIFEST_INVALID = "invalid";

const KNOWN_FEATURES = new Set([FEATURE_TRANSLATION, FEATURE_PANEL_RESIZE]);

function isHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function isSafeOwnedRel(rel) {
  if (typeof rel !== "string" || !rel) return false;
  if (rel.includes("\0") || rel.includes("\u0000")) return false;
  if (rel.includes("\\") || path.isAbsolute(rel)) return false;
  if (/^[A-Za-z]:/.test(rel) || rel.startsWith("//") || rel.startsWith("\\\\")) return false;
  const parts = rel.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return false;
  if (rel === "index.html") return true;
  if (parts[0] === "assets" && parts.length === 2 && parts[1].endsWith(".js")) return true;
  return false;
}

export function isSafeOwnedPath(rel) {
  if (isSafeOwnedRel(rel)) return true;
  if (typeof rel !== "string" || !rel) return false;
  if (rel.includes("\0")) return false;
  if (rel.includes("\\") || path.isAbsolute(rel)) return false;
  if (/^[A-Za-z]:/.test(rel) || rel.startsWith("//") || rel.startsWith("\\\\")) return false;
  const parts = rel.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return false;
  if (rel === ".paperclip-ru/manifest.json") return true;
  if (rel.startsWith(".paperclip-ru/baseline/") && isSafeOwnedRel(rel.slice(".paperclip-ru/baseline/".length))) return true;
  return false;
}

export function computeOwnedPaths(ownedFiles) {
  return [
    `assets/${OVERLAY_FILE}`,
    ".paperclip-ru/manifest.json",
    ...ownedFiles.map((rel) => `.paperclip-ru/baseline/${rel}`),
  ];
}

export function inspectManifestFile(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return { status: MANIFEST_ABSENT, manifest: null, reason: null };
  }
  let raw;
  try {
    raw = JSON.parse(readText(manifestPath).replace(/^\uFEFF/, ""));
  } catch {
    return { status: MANIFEST_INVALID, manifest: null, reason: "parse-error" };
  }
  const normalized = normalizeManifest(raw, { strict: true });
  if (!normalized) {
    const diagnostic = normalizeManifest(raw, { strict: false });
    return { status: MANIFEST_INVALID, manifest: diagnostic, reason: diagnostic ? "incomplete" : "schema" };
  }
  return { status: MANIFEST_VALID, manifest: normalized, reason: null };
}

export function loadManifest(work) {
  const inspected = inspectManifestFile(work?.manifest);
  if (inspected.status === MANIFEST_VALID) return inspected.manifest;
  return null;
}

export function normalizeManifest(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const schema = raw.schema || raw.manifestSchema;
  if (!MANIFEST_SCHEMAS_SUPPORTED.includes(schema)) return null;
  if (!raw.files || typeof raw.files !== "object" || Array.isArray(raw.files)) return null;

  const files = {};
  for (const [rel, rec] of Object.entries(raw.files)) {
    if (!isSafeOwnedRel(rel)) return null;
    if (!rec || typeof rec !== "object") return null;
    if (!isHash(rec.baselineHash) || !isHash(rec.patchedHash)) return null;
    files[rel] = {
      baselineHash: rec.baselineHash.toLowerCase(),
      patchedHash: rec.patchedHash.toLowerCase(),
    };
  }

  const fileKeys = Object.keys(files);
  const ownedFiles = Array.isArray(raw.ownedFiles)
    ? raw.ownedFiles
    : (strict ? [] : fileKeys);
  const inspectedTargets = Array.isArray(raw.inspectedTargets)
    ? raw.inspectedTargets
    : (strict ? [] : ownedFiles);

  if (ownedFiles.some((rel) => typeof rel !== "string" || !isSafeOwnedRel(rel))) return null;
  if (new Set(ownedFiles).size !== ownedFiles.length) return null;

  const serverVersion = typeof raw.serverVersion === "string" && raw.serverVersion
    ? raw.serverVersion
    : (strict ? null : (typeof raw.paperclipVersion === "string" ? raw.paperclipVersion : null));
  const paperclipVersion = typeof raw.paperclipVersion === "string" && raw.paperclipVersion
    ? raw.paperclipVersion
    : (strict ? null : serverVersion);
  let overlayHash = raw.overlayHash || null;
  if (overlayHash && !isHash(overlayHash)) return null;
  if (overlayHash) overlayHash = overlayHash.toLowerCase();

  if (strict) {
    if (schema !== MANIFEST_SCHEMA) return null;
    if (raw.tool !== TOOL_NAME) return null;
    if (!raw.toolVersion || typeof raw.toolVersion !== "string") return null;
    if (!serverVersion || !paperclipVersion || serverVersion !== paperclipVersion) return null;
    if (!isHash(raw.dictionaryHash)) return null;
    if (!overlayHash) return null;
    if (!raw.overlayStamp) return null;
    if (!fileKeys.length) return null;
    if (!ownedFiles.length) return null;
    if (ownedFiles.slice().sort().join("\0") !== fileKeys.slice().sort().join("\0")) return null;
    if (inspectedTargets.some((rel) => typeof rel !== "string" || !isSafeOwnedRel(rel))) return null;
    if (new Set(inspectedTargets).size !== inspectedTargets.length) return null;
    if (!inspectedTargets.length || fileKeys.some((rel) => !inspectedTargets.includes(rel))) return null;
    if (typeof raw.overlayStamp !== "string" || !raw.overlayStamp) return null;
    if (raw.overlayStamp !== overlayHash.slice(0, 10)) return null;
    if (!Array.isArray(raw.ownedPaths) || !raw.ownedPaths.length) return null;
    if (raw.ownedPaths.some((rel) => typeof rel !== "string" || !isSafeOwnedPath(rel))) return null;
    const expectedPaths = computeOwnedPaths(ownedFiles);
    if ([...raw.ownedPaths].sort().join("\0") !== [...expectedPaths].sort().join("\0")) return null;
    if (!isHash(raw.uiDistFingerprint)) return null;
    const features = Array.isArray(raw.features) ? raw.features : [];
    if (!features.length || features.some((f) => !KNOWN_FEATURES.has(f))) return null;
  }

  const ownedPaths = Array.isArray(raw.ownedPaths)
    ? raw.ownedPaths.filter((x) => typeof x === "string")
    : computeOwnedPaths(ownedFiles.length ? ownedFiles : fileKeys);

  return {
    schema,
    tool: raw.tool || TOOL_NAME,
    toolVersion: raw.toolVersion || null,
    serverVersion,
    paperclipVersion,
    dictionaryHash: raw.dictionaryHash || raw.dictionaryFingerprint || null,
    dictionaryFingerprint: raw.dictionaryFingerprint || raw.dictionaryHash || null,
    appliedAt: raw.appliedAt || null,
    features: Array.isArray(raw.features) ? raw.features : [FEATURE_TRANSLATION],
    files,
    overlayStamp: raw.overlayStamp || null,
    overlayHash,
    dictionaryEntries: raw.dictionaryEntries || null,
    uiDistFingerprint: raw.uiDistFingerprint || null,
    inspectedTargets,
    ownedFiles,
    ownedPaths,
  };
}

export function buildManifest({
  serverVersion,
  dictionaryHash,
  dictionaryEntries,
  files,
  features,
  overlayStamp,
  overlayHash,
  uiDistFingerprint,
  inspectedTargets,
  ownedFiles,
  ownedPaths,
  appliedAt = new Date().toISOString(),
}) {
  const owned = ownedFiles ?? Object.keys(files || {});
  return {
    schema: MANIFEST_SCHEMA,
    tool: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    paperclipVersion: serverVersion,
    serverVersion,
    dictionaryHash,
    dictionaryFingerprint: dictionaryHash,
    dictionaryEntries,
    features: features ?? [FEATURE_TRANSLATION],
    appliedAt,
    overlayStamp,
    overlayHash,
    uiDistFingerprint: uiDistFingerprint || sha256(Buffer.from(
      Object.keys(files || {}).sort().map((k) => `${k}:${files[k].baselineHash}`).join("|"),
    )),
    inspectedTargets: inspectedTargets ?? owned,
    ownedFiles: owned,
    ownedPaths: ownedPaths ?? [
      `assets/${OVERLAY_FILE}`,
      ".paperclip-ru/manifest.json",
      ...owned.map((rel) => `.paperclip-ru/baseline/${rel}`),
    ],
    files,
  };
}

export function featureList(panelResize) {
  return panelResize ? [FEATURE_TRANSLATION, FEATURE_PANEL_RESIZE] : [FEATURE_TRANSLATION];
}

export function featuresEqual(a, b) {
  const left = [...(a || [])].map(String).sort();
  const right = [...(b || [])].map(String).sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

export function overlayRel() {
  return path.posix.join("assets", OVERLAY_FILE);
}

export function fileRecord(rel, baselineHash, patchedHash) {
  return { [rel]: { baselineHash, patchedHash } };
}

export function liveHash(uiDist, rel) {
  const file = path.join(uiDist, rel);
  if (!fs.existsSync(file)) return null;
  return sha256(fs.readFileSync(file));
}

/**
 * v2 is invalid under strict v3, but apply may migrate it when every owned
 * baseline/live hash, overlay file and index marker are proven. No write.
 */
export function proveLegacyV2Manifest({ work, server, indexHtml, hashOf }) {
  if (!work?.manifest || !fs.existsSync(work.manifest)) return null;
  let raw;
  try {
    raw = JSON.parse(readText(work.manifest).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (raw.schema !== "paperclip-ru-manifest/v2") return null;
  const diagnostic = normalizeManifest(raw, { strict: false });
  if (!diagnostic?.files) return null;
  const owned = Object.keys(diagnostic.files);
  if (!owned.length) return null;
  const digest = hashOf || ((file) => sha256(fs.readFileSync(file)));
  for (const rel of owned) {
    const rec = diagnostic.files[rel];
    if (!rec || !isSafeOwnedRel(rel)) return null;
    const baselineFile = path.join(work.baseline, rel);
    if (!fs.existsSync(baselineFile) || digest(baselineFile) !== rec.baselineHash) return null;
    const liveFile = path.join(server.uiDist, rel);
    if (!fs.existsSync(liveFile) || digest(liveFile) !== rec.patchedHash) return null;
  }
  const overlayFile = path.join(server.uiDist, "assets", OVERLAY_FILE);
  if (!fs.existsSync(overlayFile)) return null;
  if (typeof indexHtml !== "string" || !indexHtml.includes("PAPERCLIP_RU_OVERLAY")) return null;
  const overlayHash = digest(overlayFile);
  if (!isHash(overlayHash)) return null;
  if (!diagnostic.dictionaryHash && !diagnostic.dictionaryFingerprint) return null;
  return buildManifest({
    serverVersion: diagnostic.serverVersion || diagnostic.paperclipVersion || server.version,
    dictionaryHash: diagnostic.dictionaryHash || diagnostic.dictionaryFingerprint,
    dictionaryEntries: diagnostic.dictionaryEntries,
    files: diagnostic.files,
    features: diagnostic.features?.length ? diagnostic.features : [FEATURE_TRANSLATION],
    overlayStamp: diagnostic.overlayStamp || "migrated-v2",
    overlayHash,
    uiDistFingerprint: diagnostic.uiDistFingerprint,
    inspectedTargets: owned,
    ownedFiles: owned,
  });
}
