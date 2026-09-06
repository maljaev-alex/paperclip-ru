import fs from "node:fs";
import path from "node:path";
import { INDEX_MARKER, NEXT_ACTION, OVERLAY_FILE, STATE, TOOL_VERSION } from "./constants.mjs";
import { hashFile } from "./fs-atomic.mjs";
import { featureList, featuresEqual, inspectManifestFile, MANIFEST_INVALID, overlayRel } from "./manifest.mjs";
import { fingerprintRecord } from "./fingerprints.mjs";

export function hasIndexMarker(html) {
  return typeof html === "string" && html.includes(INDEX_MARKER);
}

export function overlayPathOf(server) {
  return path.join(server.uiDist, "assets", OVERLAY_FILE);
}

export function collectOrphans({ server, work, indexHtml }) {
  const orphans = [];
  const overlayPath = overlayPathOf(server);
  if (fs.existsSync(overlayPath)) orphans.push("overlay");
  if (hasIndexMarker(indexHtml || "")) orphans.push("index-marker");
  if (work?.root && fs.existsSync(work.root)) {
    try {
      const entries = fs.readdirSync(work.root);
      if (entries.length) orphans.push("workdir");
    } catch {
      orphans.push("workdir");
    }
  }
  return orphans;
}

function conflict(state, conflicts, extra = {}) {
  return {
    state,
    conflicts,
    stale: Boolean(extra.stale),
    compatible: extra.compatible !== false,
    overlayPresent: Boolean(extra.overlayPresent),
    baselineSafe: extra.baselineSafe !== false,
    versionChanged: Boolean(extra.versionChanged),
    chunkSetChanged: Boolean(extra.chunkSetChanged),
    fingerprintChanged: Boolean(extra.fingerprintChanged),
    featureChanged: Boolean(extra.featureChanged),
    manifestStatus: extra.manifestStatus ?? null,
    reason: extra.reason ?? conflicts[0]?.reason ?? null,
    ...extra,
  };
}

export function classifyState({
  server,
  manifestInspection,
  targets,
  live,
  dict,
  panelResize,
  compat,
  work,
}) {
  if (!server) {
    return {
      state: STATE.NOT_INSTALLED,
      conflicts: [],
      stale: false,
      compatible: false,
      overlayPresent: false,
      baselineSafe: null,
      manifestStatus: "absent",
    };
  }

  const assessment = compat;
  const overlayPath = overlayPathOf(server);
  const overlayPresent = fs.existsSync(overlayPath);
  const overlayLiveHash = overlayPresent ? hashFile(overlayPath) : null;
  const indexHtml = live.get("index.html") || "";
  const features = panelResize ? featureList(true) : null;

  const inspected = manifestInspection || inspectManifestFile(work?.manifest);
  if (inspected.status === MANIFEST_INVALID) {
    return conflict(STATE.CONFLICT, [{ file: ".paperclip-ru/manifest.json", reason: "invalid-manifest", expected: "valid schema", actual: inspected.reason }], {
      overlayPresent,
      baselineSafe: false,
      manifestStatus: MANIFEST_INVALID,
      compatible: assessment?.compatible !== false,
    });
  }

  if (inspected.status === "absent" || !inspected.manifest) {
    const orphans = collectOrphans({ server, work, indexHtml });
    if (orphans.length) {
      return conflict(STATE.CONFLICT, orphans.map((reason) => ({
        file: reason === "overlay" ? overlayRel() : reason === "index-marker" ? "index.html" : ".paperclip-ru",
        reason: `orphaned-${reason}`,
        expected: "чистая установка без артефактов перевода",
        actual: reason,
      })), {
        overlayPresent,
        baselineSafe: false,
        manifestStatus: "absent",
        compatible: assessment?.compatible !== false,
        reason: "orphaned-artifacts",
      });
    }
    if (!assessment?.compatible) {
      return {
        state: STATE.UNSUPPORTED,
        conflicts: [],
        stale: false,
        compatible: false,
        support: assessment?.support,
        reason: assessment?.reason,
        overlayPresent,
        baselineSafe: true,
        manifestStatus: "absent",
      };
    }
    return {
      state: STATE.INSTALLED_NOT_APPLIED,
      conflicts: [],
      stale: false,
      compatible: true,
      overlayPresent: false,
      baselineSafe: true,
      manifestStatus: "absent",
    };
  }

  if (!assessment?.compatible) {
    return {
      state: STATE.UNSUPPORTED,
      conflicts: [],
      stale: false,
      compatible: false,
      support: assessment?.support,
      reason: assessment?.reason,
      overlayPresent,
      baselineSafe: null,
      manifestStatus: inspected.status,
    };
  }

  const manifest = inspected.manifest;
  const owned = manifest.ownedFiles?.length ? manifest.ownedFiles : Object.keys(manifest.files || {});
  const inspectedTargets = manifest.inspectedTargets?.length ? manifest.inspectedTargets : owned;
  const conflicts = [];
  let patchedCount = 0;
  let baselineCount = 0;
  let baselineSafe = true;

  for (const rel of owned) {
    const rec = manifest.files?.[rel];
    if (!rec) {
      conflicts.push({ file: rel, reason: "owned-missing-record", expected: "file record", actual: null });
      continue;
    }
    const baselineFile = path.join(work.baseline, rel);
    if (!fs.existsSync(baselineFile)) {
      baselineSafe = false;
      conflicts.push({ file: rel, reason: "missing-baseline", expected: rec.baselineHash, actual: null });
      continue;
    }
    const baselineHash = hashFile(baselineFile);
    if (baselineHash !== rec.baselineHash) {
      baselineSafe = false;
      conflicts.push({ file: rel, reason: "corrupt-baseline", expected: rec.baselineHash, actual: baselineHash });
      continue;
    }
    const liveFile = path.join(server.uiDist, rel);
    if (!fs.existsSync(liveFile)) {
      conflicts.push({ file: rel, reason: "missing-live", expected: rec.patchedHash, actual: null });
      continue;
    }
    const liveHash = hashFile(liveFile);
    if (liveHash === rec.patchedHash) patchedCount += 1;
    else if (liveHash === rec.baselineHash) baselineCount += 1;
    else {
      conflicts.push({
        file: rel,
        reason: "hash-mismatch",
        expected: rec.patchedHash,
        actual: liveHash,
        baselineHash: rec.baselineHash,
      });
    }
  }

  if (manifest.overlayHash) {
    if (!overlayPresent) {
      conflicts.push({ file: overlayRel(), reason: "missing-overlay", expected: manifest.overlayHash, actual: null });
    } else if (overlayLiveHash !== manifest.overlayHash) {
      conflicts.push({ file: overlayRel(), reason: "overlay-hash-mismatch", expected: manifest.overlayHash, actual: overlayLiveHash });
    }
  } else if (overlayPresent) {
    // v2 fallback: overlay exists but hash was not recorded — not applied/current.
    conflicts.push({ file: overlayRel(), reason: "overlay-hash-missing", expected: "overlayHash", actual: overlayLiveHash });
  } else {
    conflicts.push({ file: overlayRel(), reason: "missing-overlay", expected: "overlay", actual: null });
  }

  if (!hasIndexMarker(indexHtml)) {
    conflicts.push({ file: "index.html", reason: "missing-index-marker", expected: INDEX_MARKER, actual: "absent" });
  }

  if (owned.length && patchedCount === 0 && baselineCount === owned.length) {
    return conflict(STATE.CONFLICT_PARTIAL, [{
      file: owned.join(","),
      reason: "all-live-equal-baseline",
      expected: "все owned files = patchedHash",
      actual: `patched=0, baseline=${baselineCount}`,
    }, ...conflicts], {
      overlayPresent,
      baselineSafe,
      manifestStatus: "valid",
      compatible: true,
    });
  }

  const mixed = patchedCount > 0 && baselineCount > 0 && conflicts.filter((c) => c.reason === "hash-mismatch").length === 0;
  if (mixed) {
    return conflict(STATE.CONFLICT_PARTIAL, [{
      file: owned.join(","),
      reason: "partial-apply",
      expected: "все owned files = patchedHash",
      actual: `patched=${patchedCount}, baseline=${baselineCount}`,
    }, ...conflicts], {
      overlayPresent,
      baselineSafe,
      manifestStatus: "valid",
      compatible: true,
    });
  }

  if (conflicts.length) {
    const state = conflicts.some((c) => c.reason === "hash-mismatch" || c.reason === "overlay-hash-mismatch" || c.reason === "partial-apply")
      ? (baselineCount && patchedCount ? STATE.CONFLICT_PARTIAL : STATE.CONFLICT)
      : STATE.CONFLICT;
    return conflict(state, conflicts, {
      overlayPresent,
      baselineSafe,
      manifestStatus: "valid",
      compatible: true,
    });
  }

  const officialFp = fingerprintRecord(server.version);
  if (officialFp?.fingerprint && manifest.uiDistFingerprint && officialFp.fingerprint !== manifest.uiDistFingerprint) {
    return conflict(STATE.CONFLICT, [{
      file: "ui-dist",
      reason: "ui-dist-fingerprint-mismatch",
      expected: officialFp.fingerprint,
      actual: manifest.uiDistFingerprint,
    }], {
      overlayPresent,
      baselineSafe,
      manifestStatus: "valid",
      compatible: true,
    });
  }
  if (officialFp?.files) {
    const extra = [...targets].filter((rel) => !officialFp.files[rel]);
    const missing = Object.keys(officialFp.files).filter((rel) => !targets.includes(rel));
    if (extra.length || missing.length) {
      return conflict(STATE.CONFLICT, [{
        file: extra[0] || missing[0],
        reason: extra.length ? "ui-dist-extra-file" : "ui-dist-missing-file",
        expected: "official fingerprint inventory",
        actual: extra.join(",") || missing.join(","),
      }], {
        overlayPresent,
        baselineSafe,
        manifestStatus: "valid",
        compatible: true,
      });
    }
  }

  const versionChanged = manifest.serverVersion !== server.version;
  const oldInspected = new Set(inspectedTargets);
  const newInspected = new Set(targets);
  const chunkSetChanged =
    [...newInspected].some((f) => !oldInspected.has(f)) ||
    [...oldInspected].some((f) => f !== "index.html" && !newInspected.has(f));

  if (versionChanged) {
    return {
      state: STATE.APPLIED_STALE,
      conflicts: [],
      stale: true,
      compatible: true,
      overlayPresent,
      baselineSafe,
      versionChanged: true,
      chunkSetChanged,
      manifestStatus: "valid",
    };
  }

  if (chunkSetChanged) {
    return {
      state: STATE.APPLIED_STALE,
      conflicts: [],
      stale: true,
      compatible: true,
      overlayPresent,
      baselineSafe,
      chunkSetChanged: true,
      manifestStatus: "valid",
    };
  }

  const fingerprintChanged = manifest.dictionaryHash && dict?.fingerprint && manifest.dictionaryHash !== dict.fingerprint;
  const expectedFeatures = features || (manifest.features?.length ? manifest.features : featureList(false));
  const featureChanged = !featuresEqual(manifest.features, expectedFeatures);
  if (fingerprintChanged || featureChanged || (manifest.toolVersion && manifest.toolVersion !== TOOL_VERSION)) {
    return {
      state: STATE.APPLIED_STALE,
      conflicts: [],
      stale: true,
      compatible: true,
      overlayPresent,
      baselineSafe,
      fingerprintChanged,
      featureChanged,
      manifestStatus: "valid",
    };
  }

  return {
    state: STATE.APPLIED_CURRENT,
    conflicts: [],
    stale: false,
    compatible: true,
    overlayPresent,
    baselineSafe,
    manifestStatus: "valid",
  };
}

export function classifyFail(server, classified, action = "verify") {
  const conflictState = classified.state === STATE.CONFLICT || classified.state === STATE.CONFLICT_PARTIAL;
  return {
    ok: false,
    action,
    changed: false,
    stateBefore: classified.state,
    stateAfter: classified.state,
    paperclipVersion: server?.version ?? null,
    compatible: classified.compatible ?? null,
    targetDir: server?.uiDist ?? null,
    baselineSafe: classified.baselineSafe ?? false,
    warnings: (classified.conflicts || []).map((c) => `${c.file}: ${c.reason}`),
    nextAction: conflictState ? NEXT_ACTION.FORCE_MANUAL : NEXT_ACTION.APPLY,
    verification: { conflicts: classified.conflicts || [] },
    error: classified.reason || classified.conflicts?.[0]?.reason || classified.state,
  };
}
