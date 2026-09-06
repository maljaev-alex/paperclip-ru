import fs from "node:fs";
import path from "node:path";
import {
  EXIT,
  INDEX_MARKER,
  NEXT_ACTION,
  OVERLAY_FILE,
  STATE,
  TOOL_VERSION,
  WORK_DIR_NAME,
} from "./constants.mjs";
import { ToolError, assertInside, atomicWriteFile, copyFileAtomic, ensureDir, hashFile, isPermissionError, sha256 } from "./fs-atomic.mjs";
import { findServerPackage, listTargets, workPaths } from "./paths.mjs";
import { loadDictionary, dictionaryStats } from "./dictionary.mjs";
import { extractOccurrences, applyDictionary } from "./strings.mjs";
import { buildOverlay, patchIndexHtml, patchInstructionDirtyCompare, patchSkillOverviewNavigation } from "./overlay.mjs";
import { assessCompatibility, loadCompatibility } from "./compatibility.mjs";
import { buildManifest, featureList, featuresEqual, inspectManifestFile, liveHash, overlayRel, proveLegacyV2Manifest } from "./manifest.mjs";
import { classifyFail, classifyState, hasIndexMarker, overlayPathOf } from "./classify.mjs";
import { fingerprintRecord, matchFingerprint } from "./fingerprints.mjs";
import { hit } from "./failpoints.mjs";
import { inventoryDir, newJournal, beginJournal, pendingJournal, persistJournal, persistRecoverySnapshots, journalStep, cleanupJournal, restoreSnapshotMaps, recoverUnfinishedJournal } from "./journal.mjs";

export { hasIndexMarker };

function posixRel(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function readLiveMap(server, targets) {
  const live = new Map();
  for (const rel of targets) {
    const file = path.join(server.uiDist, rel);
    assertInside(server.uiDist, file);
    live.set(rel, fs.readFileSync(file, "utf8"));
  }
  return live;
}

function patchJs(source, dict) {
  let occurrences;
  try {
    occurrences = extractOccurrences(source);
  } catch (err) {
    return { code: source, replacements: 0, used: new Map(), skipped: err.message, dirtyPatched: false, overviewTabPatched: false };
  }
  const result = applyDictionary(source, occurrences, dict.exact, { skipStatic: dict.noStatic });
  const dirty = patchInstructionDirtyCompare(result.code);
  const overview = patchSkillOverviewNavigation(dirty.code);
  return {
    code: overview.code,
    replacements: result.replacements,
    used: result.used,
    skipped: null,
    dirtyPatched: dirty.patched,
    overviewTabPatched: overview.patched,
  };
}

export function planPatch({ server, dict, targets, live, panelResize, stats }) {
  const planned = [];
  const usedTotal = new Map();
  let jsReplacements = 0;
  let dirtyPatched = false;
  let overviewTabPatched = false;

  for (const rel of targets) {
    if (rel === "index.html") continue;
    const source = live.get(rel);
    const patched = patchJs(source, dict);
    jsReplacements += patched.replacements;
    if (patched.dirtyPatched) dirtyPatched = true;
    if (patched.overviewTabPatched) overviewTabPatched = true;
    for (const [k, v] of patched.used) usedTotal.set(k, (usedTotal.get(k) || 0) + v);
    planned.push({
      rel,
      fromHash: sha256(Buffer.from(source)),
      toHash: sha256(Buffer.from(patched.code)),
      replacements: patched.replacements,
      skipped: patched.skipped,
      dirtyPatched: patched.dirtyPatched,
      overviewTabPatched: patched.overviewTabPatched,
      bytesChanged: source !== patched.code,
      content: patched.code,
    });
  }

  const overlay = buildOverlay(dict, { toolVersion: TOOL_VERSION, serverVersion: server.version }, { panelResize });
  const overlayHash = sha256(Buffer.from(overlay));
  const overlayStamp = overlayHash.slice(0, 10);
  const html = patchIndexHtml(live.get("index.html"), overlayStamp);

  planned.push({
    rel: "index.html",
    fromHash: sha256(Buffer.from(live.get("index.html"))),
    toHash: sha256(Buffer.from(html)),
    replacements: hasIndexMarker(html) ? 1 : 0,
    skipped: null,
    dirtyPatched: false,
    overviewTabPatched: false,
    bytesChanged: live.get("index.html") !== html,
    content: html,
  });

  return {
    planned,
    overlay,
    overlayHash,
    overlayStamp,
    jsReplacements,
    usedTotal,
    dirtyPatched,
    overviewTabPatched,
    stats,
  };
}

function throwClosed(message, { exitCode, nextAction, server, classified, extra = {} }) {
  throw new ToolError(message, {
    exitCode,
    nextAction,
    details: extra.details ?? { conflicts: classified?.conflicts },
    result: {
      ok: false,
      changed: extra.changed ?? false,
      stateBefore: extra.stateBefore ?? classified?.state ?? null,
      stateAfter: extra.stateAfter ?? classified?.state ?? STATE.CONFLICT,
      paperclipVersion: server?.version ?? extra.paperclipVersion ?? null,
      toolVersion: TOOL_VERSION,
      compatible: extra.compatible ?? classified?.compatible ?? null,
      targetDir: server?.uiDist ?? extra.targetDir ?? null,
      baselineSafe: extra.baselineSafe ?? classified?.baselineSafe ?? false,
      verification: extra.verification ?? { conflicts: classified?.conflicts ?? [] },
      warnings: extra.warnings ?? [],
      error: message,
    },
  });
}

function assertFingerprintForFirstApply({ server, targets, assessment, forceBaseline }) {
  if (forceBaseline) {
    return { skipped: true, warning: "force-baseline: проверка fingerprint ui-dist пропущена." };
  }
  const record = fingerprintRecord(server.version);
  if (!record) {
    throwClosed(
      `Нет воспроизводимого fingerprint ui-dist для Paperclip ${server.version}. Первый apply к поддерживаемой версии отказан: нельзя доказать официальный бандл.`,
      {
        exitCode: EXIT.CONFLICT,
        nextAction: NEXT_ACTION.UPDATE_TOOL,
        server,
        extra: {
          stateAfter: STATE.CONFLICT,
          compatible: assessment.compatible,
          baselineSafe: true,
          details: { reason: "fingerprint-missing", version: server.version },
        },
      }
    );
  }
  const match = matchFingerprint({ record, uiDist: server.uiDist, targets });
  if (!match.ok) {
    throwClosed(
      `Первый apply отказан: ui-dist ${server.version} не совпадает с официальным fingerprint (${match.reason}). Посторонние изменения не принимаются как baseline.`,
      {
        exitCode: EXIT.CONFLICT,
        nextAction: NEXT_ACTION.FORCE_MANUAL,
        server,
        extra: {
          stateAfter: STATE.CONFLICT,
          compatible: true,
          baselineSafe: true,
          details: match,
        },
      }
    );
  }
  return { skipped: false, fingerprint: match.fingerprint || record.fingerprint };
}

function snapshotDir(dir) {
  const files = new Map();
  const dirs = {};
  if (!dir || !fs.existsSync(dir)) return { existed: false, files, dirs };
  const walk = (current, relBase) => {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const p = path.join(current, ent.name);
      assertInside(dir, p);
      if (ent.isDirectory()) {
        dirs[rel] = { type: "dir", mode: fs.statSync(p).mode & 0o777 };
        walk(p, rel);
      } else {
        const buf = fs.readFileSync(p);
        const st = fs.statSync(p);
        buf._mtime = st.mtime;
        buf._atime = st.atime;
        buf._mode = st.mode & 0o777;
        files.set(rel, buf);
      }
    }
  };
  walk(dir, "");
  return { existed: true, files, dirs, mode: fs.statSync(dir).mode & 0o777 };
}

function snapshotLiveFiles(server, rels) {
  const files = new Map();
  for (const rel of rels) {
    const file = path.join(server.uiDist, rel);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const st = fs.statSync(file);
    buf._mtime = st.mtime;
    buf._atime = st.atime;
    buf._mode = st.mode & 0o777;
    files.set(rel, buf);
  }
  return files;
}

/**
 * Files inside the tool's own root that the manifest does not declare. Older
 * revisions saved a baseline for every inspected target instead of only the
 * owned ones, so an upgraded install can carry hundreds of undeclared bytes
 * that no integrity check would otherwise mention. Journal, recovery, staging
 * and tmp are live transaction state, not declared inventory.
 */
const TRANSIENT_WORK_ENTRIES = /^(journal\.json|recovery\/|staging\/|tmp\/)/;

export function undeclaredOwnedEntries({ server, work, manifest }) {
  if (!work?.root || !fs.existsSync(work.root)) return [];
  const declared = new Set(
    (manifest?.ownedPaths || [])
      .filter((rel) => rel.startsWith(`${WORK_DIR_NAME}/`))
      .map((rel) => rel.slice(WORK_DIR_NAME.length + 1)),
  );
  const found = [];
  for (const rel of Object.keys(inventoryDir(work.root).files)) {
    if (TRANSIENT_WORK_ENTRIES.test(rel)) continue;
    if (declared.has(rel)) continue;
    found.push(`${WORK_DIR_NAME}/${rel}`);
  }
  void server;
  return found.sort();
}

/**
 * Removes every non-transient file in the owned root that the manifest about
 * to be written does not declare. Scoped to the whole root rather than just
 * `baseline/`, so that a stray undeclared file cannot keep `alreadyCurrent`
 * false on every future run.
 */
function pruneUndeclaredOwned({ work, ownedRels, step }) {
  if (!fs.existsSync(work.root)) return [];
  const keep = new Set(["manifest.json", ...ownedRels.map((rel) => `baseline/${rel}`)]);
  const removed = [];
  const inv = inventoryDir(work.root);
  for (const rel of Object.keys(inv.files)) {
    if (TRANSIENT_WORK_ENTRIES.test(rel) || keep.has(rel)) continue;
    const victim = path.join(work.root, rel);
    assertInside(work.root, victim);
    step("remove-stale-owned", () => fs.unlinkSync(victim), { rel });
    removed.push(rel);
  }
  for (const rel of Object.keys(inv.dirs).sort((a, b) => b.length - a.length)) {
    if (TRANSIENT_WORK_ENTRIES.test(`${rel}/`)) continue;
    const dir = path.join(work.root, rel);
    assertInside(work.root, dir);
    try {
      if (!fs.readdirSync(dir).length) step("remove-stale-owned-directory", () => fs.rmdirSync(dir), { rel });
    } catch { /* a non-empty directory is left alone */ }
  }
  return removed;
}

function removeRecordedTree(root, step, prefix) {
  const inv = inventoryDir(root);
  for (const rel of Object.keys(inv.files)) {
    step(`${prefix}-file`, () => fs.unlinkSync(path.join(root, rel)), { rel });
  }
  for (const rel of Object.keys(inv.dirs).sort((a, b) => b.length - a.length)) {
    step(`${prefix}-directory`, () => fs.rmdirSync(path.join(root, rel)), { rel });
  }
  if (fs.existsSync(root)) step(`${prefix}-directory`, () => fs.rmdirSync(root));
}

function transactionFailure({ action, err, server, work, journal, snapLive, snapWork, createdLive, classified }) {
  if (err.code === "EEXIST") throwClosed("Another transaction owns the journal", { exitCode: EXIT.CONFLICT, nextAction: NEXT_ACTION.FORCE_MANUAL, server });
  let rollbackOk = false;
  let rollbackError = null;
  try {
    restoreSnapshotMaps({ server, work, journal, snapLive, snapWork, createdLive });
    journal.recovery = "rolled-back";
    persistJournal(work, journal);
    cleanupJournal(work, journal, { removeWorkRoot: !snapWork.existed });
    rollbackOk = true;
  } catch (restoreError) {
    rollbackError = restoreError.message;
    try { persistJournal(work, { ...journal, recovery: "unproven", error: err.message, rollbackError }); } catch { /* retain evidence */ }
  }
  throwClosed(rollbackOk
    ? `Сбой ${action}; исходные файлы и каталоги восстановлены: ${err.message}`
    : `Сбой ${action}; rollback не доказан. Journal сохранён: ${rollbackError}`, {
    exitCode: isPermissionError(err) ? EXIT.PERMISSION : EXIT.ERROR,
    nextAction: rollbackOk ? NEXT_ACTION.NONE : NEXT_ACTION.FORCE_MANUAL,
    server, classified,
    extra: { action, changed: !rollbackOk, stateAfter: rollbackOk ? classified?.state : STATE.CONFLICT_PARTIAL,
      baselineSafe: rollbackOk ? classified?.baselineSafe ?? true : false,
      details: { rollbackOk, rollbackError, failpoint: err.failpoint, journal: rollbackOk ? null : work.journal } },
  });
}

function finishTransaction(work, journal, warnings, removeWorkRoot = false) {
  // Commit is durable before disposal of recovery bytes. An interrupted disposal
  // is retried by the next mutation; it cannot turn a verified commit into rollback.
  try { cleanupJournal(work, journal, { removeWorkRoot }); }
  catch (err) { warnings.push(`Результат проверен; очистка журнала будет повторена следующей командой: ${err.message}`); }
}

function conflictState(classified) {
  return classified.state === STATE.CONFLICT || classified.state === STATE.CONFLICT_PARTIAL;
}

function liveNeedsSurgicalJsPatches(live) {
  for (const [rel, source] of live) {
    if (!rel.endsWith(".js")) continue;
    const after = patchSkillOverviewNavigation(patchInstructionDirtyCompare(source).code);
    if (after.code !== source) return true;
  }
  return false;
}

function emptyResultBase({ action, server, classified, warnings }) {
  return {
    ok: true,
    action,
    changed: false,
    stateBefore: classified.state,
    stateAfter: classified.state,
    paperclipVersion: server.version,
    toolVersion: TOOL_VERSION,
    compatible: classified.compatible ?? true,
    targetDir: server.uiDist,
    baselineSafe: classified.baselineSafe ?? true,
    warnings,
    nextAction: NEXT_ACTION.NONE,
    files: [],
    risks: [],
    verification: null,
    error: null,
  };
}

export function runApply(opts) {
  const action = opts.reapply ? "reapply" : "apply";
  const server = findServerPackage({ serverDir: opts.serverDir });
  const work = workPaths(server);
  const unfinished = opts.dryRun ? { recovered: false, blocked: Boolean(pendingJournal(work)), reason: "pending-journal" } : recoverUnfinishedJournal({ work, server });
  if (unfinished.blocked) {
    throwClosed("Найден незавершённый journal. Автоматический rollback не доказан. Запись не выполнена.", {
      exitCode: EXIT.CONFLICT,
      nextAction: NEXT_ACTION.FORCE_MANUAL,
      server,
      extra: {
        stateAfter: STATE.CONFLICT,
        compatible: true,
        baselineSafe: false,
        details: { journal: work.journal, reason: unfinished.reason },
      },
    });
  }
  const targets = listTargets(server.uiDist);
  const dict = loadDictionary();
  const stats = dictionaryStats(dict);
  const compat = loadCompatibility();
  const assessment = assessCompatibility(server.version, compat);
  const live = readLiveMap(server, targets);
  let manifestInspection = inspectManifestFile(work.manifest);
  const warnings = [];

  if (manifestInspection.status === "invalid") {
    const proven = proveLegacyV2Manifest({
      work,
      server,
      indexHtml: live.get("index.html") || "",
      hashOf: hashFile,
    });
    if (!proven) {
      throwClosed("manifest.json повреждён или неполной схемы. Запись не выполнена.", {
        exitCode: EXIT.CONFLICT,
        nextAction: NEXT_ACTION.FORCE_MANUAL,
        server,
        extra: {
          stateAfter: STATE.CONFLICT,
          compatible: assessment.compatible,
          baselineSafe: false,
          details: { manifestStatus: "invalid", reason: manifestInspection.reason },
        },
      });
    }
    warnings.push("Найден доказанный paperclip-ru-manifest/v2: при записи он будет заменён на v3.");
    manifestInspection = { status: "valid", manifest: proven, reason: "migrated-v2" };
  }

  // Omission preserves a previous explicit opt-in. A clean install stays off;
  // only an explicit false (--without-panel-resize) disables an existing choice.
  const panelResize = opts.panelResize ?? (manifestInspection.manifest?.features?.includes("panel-resize") === true);
  const classified = classifyState({
    server,
    manifestInspection,
    targets,
    live,
    dict,
    panelResize,
    compat: assessment,
    work,
  });

  if (conflictState(classified) && !opts.forceBaseline) {
    const first = classified.conflicts[0];
    throwClosed(
      `Обнаружен конфликт: ${first.file} (${first.reason}). Запись не выполнена.`,
      {
        exitCode: EXIT.CONFLICT,
        nextAction: NEXT_ACTION.FORCE_MANUAL,
        server,
        classified,
      }
    );
  }

  if (!assessment.compatible && !opts.forceBaseline) {
    throwClosed(
      `Неподдерживаемая сборка Paperclip ${server.version}. ${assessment.reason || ""} Для обхода нужен явный --force-baseline (не используется автоматически).`,
      {
        exitCode: EXIT.UNSUPPORTED,
        nextAction: NEXT_ACTION.UPDATE_TOOL,
        server,
        classified,
        extra: {
          stateBefore: classified.state === STATE.UNSUPPORTED ? STATE.UNSUPPORTED : classified.state,
          stateAfter: STATE.UNSUPPORTED,
          compatible: false,
          baselineSafe: classified.baselineSafe ?? null,
        },
      }
    );
  }

  if (opts.reapply && conflictState(classified)) {
    throwClosed("reapply отказался: неизвестная или изменённая сборка. --force-baseline не применяется автоматически.", {
      exitCode: EXIT.CONFLICT,
      nextAction: NEXT_ACTION.FORCE_MANUAL,
      server,
      classified,
    });
  }

  if (opts.forceBaseline) warnings.push("force-baseline: эталон будет перезаписан из текущих live-файлов. Это опасный ручной режим.");
  if (classified.versionChanged) {
    warnings.push(`Paperclip обновлён (${manifestInspection.manifest?.serverVersion} -> ${server.version}). Старый baseline не используется как оригинал новой версии.`);
  }
  if (panelResize) warnings.push("Опциональный модуль изменения ширины панелей включён.");

  const requestedFeatures = featureList(panelResize);
  const nextOverlay = buildOverlay(
    dict,
    { toolVersion: TOOL_VERSION, serverVersion: server.version },
    { panelResize },
  );
  const nextOverlayHash = sha256(Buffer.from(nextOverlay));
  const liveOverlayPath = overlayPathOf(server);
  const liveOverlayHash = fs.existsSync(liveOverlayPath) ? hashFile(liveOverlayPath) : null;
  let onDiskSchema = null;
  try {
    if (fs.existsSync(work.manifest)) {
      onDiskSchema = JSON.parse(fs.readFileSync(work.manifest, "utf8").replace(/^\uFEFF/, "")).schema;
    }
  } catch {
    onDiskSchema = null;
  }
  // Undeclared bytes in the owned root mean there is still work to do, so the
  // idempotent shortcut must not skip the transaction that prunes them.
  // Otherwise an install upgraded from an older revision keeps its stale
  // baseline forever, because it always classifies as applied/current.
  const undeclaredBefore = undeclaredOwnedEntries({ server, work, manifest: manifestInspection.manifest });
  const alreadyCurrent =
    classified.state === STATE.APPLIED_CURRENT &&
    manifestInspection.status === "valid" &&
    manifestInspection.reason !== "migrated-v2" &&
    onDiskSchema === "paperclip-ru-manifest/v3" &&
    manifestInspection.manifest?.schema === "paperclip-ru-manifest/v3" &&
    featuresEqual(manifestInspection.manifest?.features, requestedFeatures) &&
    liveOverlayHash === nextOverlayHash &&
    undeclaredBefore.length === 0 &&
    // A new surgical JS patch (dirty-compare, skill Overview navigation) must
    // still rewrite even when the overlay and dictionary hashes match.
    !liveNeedsSurgicalJsPatches(live) &&
    !opts.forceBaseline;

  if (undeclaredBefore.length && !alreadyCurrent) {
    warnings.push(`Внутри ${WORK_DIR_NAME} найдено неучтённых файлов: ${undeclaredBefore.length}. Они будут удалены.`);
  }

  if (alreadyCurrent) {
    const files = (manifestInspection.manifest.ownedFiles || Object.keys(manifestInspection.manifest.files || {})).map((rel) => {
      const h = hashFile(path.join(server.uiDist, rel));
      return { file: rel, replacements: 0, fromHash: h, toHash: h, changed: false };
    });
    const result = {
      ...emptyResultBase({ action, server, classified, warnings }),
      files,
      nextAction: NEXT_ACTION.NONE,
      details: {
        dictionaryEntries: stats.entries,
        dictionaryHash: dict.fingerprint,
        overlayStamp: manifestInspection.manifest.overlayStamp,
        overlayHash: manifestInspection.manifest.overlayHash ?? nextOverlayHash,
        jsReplacements: 0,
        panelResize,
        dryRun: Boolean(opts.dryRun),
        idempotent: true,
      },
      message: "Состояние уже applied/current: файлы не записывались.",
    };
    if (!opts.dryRun) {
      const verified = verifyInstall({ serverDir: server.dir, panelResize });
      if (!verified.ok) {
        throwClosed("verify не подтвердил applied/current; запись не выполнена.", {
          exitCode: EXIT.CONFLICT,
          nextAction: NEXT_ACTION.FORCE_MANUAL,
          server,
          classified,
          extra: { compatible: classified.compatible, baselineSafe: classified.baselineSafe, verification: verified.verification },
        });
      }
      result.verification = verified.verification;
    }
    return result;
  }

  if (manifestInspection.status === "absent") {
    const fp = assertFingerprintForFirstApply({
      server,
      targets,
      assessment,
      forceBaseline: opts.forceBaseline,
    });
    if (fp.warning) warnings.push(fp.warning);
  }

  const manifest = manifestInspection.manifest;
  const baselineSources = new Map();
  for (const rel of targets) {
    const rec = manifest?.files?.[rel];
    const liveText = live.get(rel);
    const saved = path.join(work.baseline, rel);
    const savedExists = rec && fs.existsSync(saved) && hashFile(saved) === rec.baselineHash;
    const savedText = savedExists ? fs.readFileSync(saved, "utf8") : null;
    const liveHash = hashFile(path.join(server.uiDist, rel));
    const liveIsKnown = rec && (liveHash === rec.patchedHash || liveHash === rec.baselineHash);

    if (!opts.forceBaseline && savedExists && liveIsKnown) {
      baselineSources.set(rel, rec && liveHash === rec.baselineHash ? liveText : savedText);
      continue;
    }
    if (!opts.forceBaseline && (classified.versionChanged || classified.chunkSetChanged)) {
      if (!rec) {
        baselineSources.set(rel, liveText);
        continue;
      }
      if (savedExists && liveHash === rec.patchedHash) {
        baselineSources.set(rel, savedText);
        continue;
      }
      baselineSources.set(rel, liveText);
      continue;
    }
    baselineSources.set(rel, liveText);
  }

  const plan = planPatch({
    server,
    dict,
    targets,
    live: baselineSources,
    panelResize,
    stats,
  });

  const ownedPlanned = plan.planned.filter((p) => p.bytesChanged || p.rel === "index.html");
  const filesManifest = {};
  for (const item of ownedPlanned) {
    filesManifest[item.rel] = {
      baselineHash: sha256(Buffer.from(baselineSources.get(item.rel))),
      patchedHash: item.toHash,
    };
  }

  const overlayRelPath = overlayRel();
  const filesVsLive = plan.planned.map((p) => {
    const liveText = live.get(p.rel) ?? "";
    const changed = liveText !== p.content;
    return {
      file: p.rel,
      replacements: p.replacements,
      fromHash: sha256(Buffer.from(liveText)),
      toHash: p.toHash,
      changed,
    };
  });
  const overlayLivePath = overlayPathOf(server);
  const overlayLiveHash = fs.existsSync(overlayLivePath) ? hashFile(overlayLivePath) : null;
  const overlayChangedVsLive = overlayLiveHash !== plan.overlayHash;

  const risks = [];
  for (const item of plan.planned) {
    if (item.skipped) risks.push(`${item.rel}: не разобран как JS (${item.skipped}), файл не патчится статически`);
    if (item.rel.endsWith(".js") && /AGENTS\.md/.test(item.content) && /onDirtyChange/.test(item.content) && !item.dirtyPatched) {
      risks.push(`${item.rel}: сигнатура сравнения инструкций не найдена; используется штатная защита несохранённых изменений`);
    }
    if (item.rel.endsWith(".js") && /==="overview"\?\w+\.delete\("tab"\):\w+\.set\("tab"/.test(item.content) && !item.overviewTabPatched) {
      risks.push(`${item.rel}: сигнатура вкладки навыка «Обзор» не применена; после открытия файла вкладка может не переключаться`);
    }
  }

  const resultBase = {
    ...emptyResultBase({ action, server, classified, warnings }),
    nextAction: NEXT_ACTION.VERIFY,
    files: filesVsLive,
    risks,
    details: {
      dictionaryEntries: stats.entries,
      dictionaryHash: dict.fingerprint,
      overlayStamp: plan.overlayStamp,
      overlayHash: plan.overlayHash,
      jsReplacements: plan.jsReplacements,
      panelResize,
      dryRun: Boolean(opts.dryRun),
      ownedFiles: ownedPlanned.map((p) => p.rel),
    },
  };

  if (opts.dryRun) {
    return {
      ...resultBase,
      changed: false,
      stateAfter: classified.state,
      nextAction: classified.state === STATE.APPLIED_CURRENT ? NEXT_ACTION.NONE : action,
      message: "dry-run: файлы не изменены",
    };
  }

  if (!server.writable) {
    throwClosed(`Недостаточно прав на запись в ${server.uiDist}`, {
      exitCode: EXIT.PERMISSION,
      nextAction: NEXT_ACTION.NONE,
      server,
      classified,
      extra: { compatible: classified.compatible, baselineSafe: classified.baselineSafe ?? null },
    });
  }

  const createdLive = [];
  if (!fs.existsSync(overlayLivePath)) createdLive.push(overlayRelPath);
  const snapLive = snapshotLiveFiles(server, [...ownedPlanned.map((p) => p.rel), overlayRelPath]);
  const snapWork = snapshotDir(work.root);
  const journal = newJournal({ action, server, work, snapLive, snapWork, createdLive });
  journal.newHashes = Object.fromEntries([...ownedPlanned.map((p) => [p.rel, p.toHash]), [overlayRelPath, plan.overlayHash]]);
  const step = (label, fn, extra) => journalStep(work, journal, label, fn, extra);
  let verify;
  let pruned = [];
  try {
    beginJournal(work, journal);
    persistRecoverySnapshots({ work, snapLive, snapWork, journal });
    step("mkdir-work", () => ensureDir(work.root));
    if (fs.existsSync(work.staging)) removeRecordedTree(work.staging, step, "remove-old-staging");
    step("mkdir-staging", () => ensureDir(work.staging));
    const stage = (rel, content, hash, label = rel) => {
      const dest = path.join(work.staging, rel);
      assertInside(work.staging, dest);
      step("mkdir-staging-parent", () => ensureDir(path.dirname(dest)), { rel });
      step(`write-staging:${label}`, () => atomicWriteFile(dest, content, { mode: 0o600 }), { rel });
      if (hash && hashFile(dest) !== hash) throw new Error(`staging hash mismatch: ${rel}`);
    };
    for (const item of ownedPlanned) stage(item.rel, item.content, item.toHash);
    stage(overlayRelPath, plan.overlay, plan.overlayHash, "overlay");
    const newManifest = buildManifest({
      serverVersion: server.version, dictionaryHash: dict.fingerprint, dictionaryEntries: stats.entries,
      files: filesManifest, features: requestedFeatures, overlayStamp: plan.overlayStamp, overlayHash: plan.overlayHash,
      uiDistFingerprint: fingerprintRecord(server.version)?.fingerprint ?? null,
      inspectedTargets: targets, ownedFiles: ownedPlanned.map((p) => p.rel),
    });
    stage("manifest.json", `${JSON.stringify(newManifest, null, 2)}\n`, null, "manifest");
    step("mkdir-baseline", () => ensureDir(work.baseline));
    for (const item of ownedPlanned) {
      const dest = path.join(work.baseline, item.rel);
      assertInside(work.root, dest);
      step("mkdir-baseline-parent", () => ensureDir(path.dirname(dest)), { rel: item.rel });
      const mode = fs.existsSync(dest) ? fs.statSync(dest).mode & 0o777 : snapLive.get(item.rel)?._mode;
      step(`write-baseline:${item.rel}`, () => atomicWriteFile(dest, baselineSources.get(item.rel), { mode }), { rel: item.rel });
    }
    pruned = pruneUndeclaredOwned({
      work,
      ownedRels: ownedPlanned.map((p) => p.rel),
      step,
    });
    if (pruned.length) {
      warnings.push(`Удалены неучтённые файлы прошлых версий внутри ${WORK_DIR_NAME}: ${pruned.length}.`);
    }
    for (const item of ownedPlanned) {
      const dest = path.join(server.uiDist, item.rel);
      assertInside(server.uiDist, dest);
      step(`write-live:${item.rel}`, () => copyFileAtomic(path.join(work.staging, item.rel), dest));
    }
    step("write-overlay", () => copyFileAtomic(path.join(work.staging, overlayRelPath), overlayLivePath));
    step("write-manifest", () => copyFileAtomic(path.join(work.staging, "manifest.json"), work.manifest));
    step("remove-staging", () => removeRecordedTree(work.staging, step, "remove-staging"));
    verify = step("post-apply-verify", () => verifyInstall({ serverDir: server.dir, panelResize, allowPendingJournal: true }));
    if (!verify.ok) throw new Error(`post-apply verify failed: ${verify.message}`);
    // The commit write can still fail safely while every recovery byte exists.
    journal.recovery = "complete";
    persistJournal(work, journal);
  } catch (err) {
    journal.recovery = "pending";
    transactionFailure({ action, err, server, work, journal, snapLive, snapWork, createdLive, classified });
  }
  finishTransaction(work, journal, warnings);
  // Pruning stale owned bytes is a real change even when every live file and
  // the overlay already had the expected content.
  const changed = filesVsLive.some((f) => f.changed) || overlayChangedVsLive || pruned.length > 0;
  return {
    ...resultBase,
    changed,
    stateAfter: STATE.APPLIED_CURRENT,
    verification: verify.verification,
    nextAction: NEXT_ACTION.NONE,
    error: null,
    message: `Применено. Замен в бандле: ${plan.jsReplacements}. Baseline: ${work.baseline}. Откат: paperclip-ru revert --server-dir "${server.dir}". Перезапуск Paperclip не выполняется; обновите страницу (Ctrl+F5).`,
  };
}

function revertPreflight({ server, work, manifest, files, opts }) {
  const conflicts = [];
  for (const rel of files) {
    const rec = manifest.files[rel];
    const saved = path.join(work.baseline, rel);
    if (!fs.existsSync(saved)) {
      conflicts.push({ file: rel, reason: "missing-baseline", expected: rec.baselineHash, actual: null });
      continue;
    }
    const actual = hashFile(saved);
    if (actual !== rec.baselineHash) {
      conflicts.push({ file: rel, reason: "corrupt-baseline", expected: rec.baselineHash, actual });
    }
    const liveH = liveHash(server.uiDist, rel);
    if (liveH !== rec.patchedHash && !opts.force) {
      conflicts.push({ file: rel, reason: "live-not-patched", expected: rec.patchedHash, actual: liveH });
    }
  }
  const indexLive = path.join(server.uiDist, "index.html");
  if (files.includes("index.html") && fs.existsSync(indexLive)) {
    const html = fs.readFileSync(indexLive, "utf8");
    if (!html.includes("PAPERCLIP_RU_OVERLAY") && !opts.force) {
      conflicts.push({ file: "index.html", reason: "missing-index-marker", expected: "PAPERCLIP_RU_OVERLAY", actual: null });
    }
  }
  if (manifest.overlayHash) {
    const overlayPath = overlayPathOf(server);
    if (!fs.existsSync(overlayPath)) {
      conflicts.push({ file: overlayRel(), reason: "missing-overlay", expected: manifest.overlayHash, actual: null });
    } else {
      const h = hashFile(overlayPath);
      if (h !== manifest.overlayHash && !opts.force) {
        conflicts.push({ file: overlayRel(), reason: "overlay-hash-mismatch", expected: manifest.overlayHash, actual: h });
      }
    }
  }
  return conflicts;
}

export function runRevert(opts) {
  const server = findServerPackage({ serverDir: opts.serverDir });
  const work = workPaths(server);
  const unfinished = opts.dryRun ? { recovered: false, blocked: Boolean(pendingJournal(work)), reason: "pending-journal" } : recoverUnfinishedJournal({ work, server });
  if (unfinished.blocked) {
    throwClosed("Найден незавершённый journal. revert не выполнен.", {
      exitCode: EXIT.CONFLICT,
      nextAction: NEXT_ACTION.FORCE_MANUAL,
      server,
      extra: {
        stateAfter: STATE.CONFLICT,
        compatible: true,
        baselineSafe: false,
        details: { journal: work.journal, reason: unfinished.reason },
      },
    });
  }
  const inspected = inspectManifestFile(work.manifest);
  const warnings = [];
  const targets = listTargets(server.uiDist);
  const live = readLiveMap(server, targets);
  const dict = loadDictionary();
  const assessment = assessCompatibility(server.version);

  if (inspected.status === "invalid") {
    throwClosed("revert отказался: manifest.json повреждён или неполной схемы. Live, manifest и baseline не изменены.", {
      exitCode: EXIT.CONFLICT,
      nextAction: NEXT_ACTION.FORCE_MANUAL,
      server,
      extra: {
        stateAfter: STATE.CONFLICT,
        compatible: assessment.compatible,
        baselineSafe: false,
        details: { reason: inspected.reason },
      },
    });
  }

  if (inspected.status === "absent" || !inspected.manifest) {
    const classified = classifyState({
      server,
      manifestInspection: inspected,
      targets,
      live,
      dict,
      panelResize: false,
      compat: assessment,
      work,
    });
    if (conflictState(classified) || classified.state === STATE.UNSUPPORTED) {
      throwClosed("revert отказался: нет валидного manifest, но остались артефакты перевода или сборка неподдерживаемая. Удаление не выполнено.", {
        exitCode: classified.state === STATE.UNSUPPORTED ? EXIT.UNSUPPORTED : EXIT.CONFLICT,
        nextAction: NEXT_ACTION.FORCE_MANUAL,
        server,
        classified,
      });
    }
    return {
      ok: true,
      action: "revert",
      changed: false,
      stateBefore: STATE.INSTALLED_NOT_APPLIED,
      stateAfter: STATE.INSTALLED_NOT_APPLIED,
      paperclipVersion: server.version,
      toolVersion: TOOL_VERSION,
      compatible: classified.compatible ?? true,
      targetDir: server.uiDist,
      baselineSafe: true,
      warnings,
      nextAction: NEXT_ACTION.NONE,
      message: "Перевод не применён (нет manifest.json) — нечего откатывать.",
      verification: { restored: 0, byteIdentical: true },
      error: null,
    };
  }

  if (!assessment.compatible) {
    throwClosed("revert отказался: сборка Paperclip неподдерживаемая. Live, manifest и baseline не изменены.", {
      exitCode: EXIT.UNSUPPORTED,
      nextAction: NEXT_ACTION.FORCE_MANUAL,
      server,
      extra: {
        stateAfter: STATE.UNSUPPORTED,
        compatible: false,
        baselineSafe: false,
      },
    });
  }

  const manifest = inspected.manifest;
  const files = manifest.ownedFiles?.length ? manifest.ownedFiles : Object.keys(manifest.files || {});
  const preflight = revertPreflight({ server, work, manifest, files, opts });
  const baselineDamage = preflight.filter((c) => c.reason === "missing-baseline" || c.reason === "corrupt-baseline");
  if (baselineDamage.length) {
    throwClosed(
      `revert отказался до записи: baseline повреждён или неполный (${baselineDamage[0].file}). Live, manifest и baseline не изменены.`,
      {
        exitCode: EXIT.CONFLICT,
        nextAction: NEXT_ACTION.FORCE_MANUAL,
        server,
        extra: {
          stateAfter: STATE.CONFLICT,
          compatible: true,
          baselineSafe: false,
          verification: { conflicts: baselineDamage, byteIdentical: false },
          details: { conflicts: baselineDamage },
        },
      }
    );
  }
  if (preflight.length && !opts.force) {
    throwClosed(`revert отказался до записи: ${preflight[0].file} (${preflight[0].reason}). Live-файлы не изменены.`, {
      exitCode: EXIT.CONFLICT,
      nextAction: NEXT_ACTION.FORCE_MANUAL,
      server,
      extra: {
        stateAfter: STATE.CONFLICT,
        compatible: true,
        baselineSafe: true,
        details: { conflicts: preflight },
      },
    });
  }
  if (preflight.length && opts.force) {
    warnings.push("force: откат перезапишет файлы, которые не совпадают с ожидаемым overlay/live hash.");
  }

  const classified = classifyState({ server, manifestInspection: inspected, targets, live, dict,
    panelResize: false, compat: assessment, work });

  if (opts.dryRun) {
    return {
      ok: true,
      action: "revert",
      changed: false,
      stateBefore: classified.state,
      stateAfter: classified.state,
      paperclipVersion: server.version,
      toolVersion: TOOL_VERSION,
      compatible: true,
      targetDir: server.uiDist,
      baselineSafe: true,
      warnings,
      nextAction: NEXT_ACTION.REVERT,
      files: files.map((rel) => ({ file: rel, changed: true })),
      message: "dry-run: файлы не изменены",
      verification: null,
      error: null,
    };
  }

  const overlayRelPath = overlayRel();
  const snapLive = snapshotLiveFiles(server, [...files, overlayRelPath]);
  const snapWork = snapshotDir(work.root);
  const hashCheck = [];
  let restored = 0;
  const journal = newJournal({ action: "revert", server, work, snapLive, snapWork, createdLive: [] });
  journal.newHashes = Object.fromEntries([...files.map((rel) => [rel, manifest.files[rel].baselineHash]), [overlayRelPath, null]]);
  const step = (label, fn, extra) => journalStep(work, journal, label, fn, extra);
  try {
    beginJournal(work, journal);
    persistRecoverySnapshots({ work, snapLive, snapWork, journal });
    for (const rel of files) {
      const saved = path.join(work.baseline, rel);
      const dest = path.join(server.uiDist, rel);
      assertInside(server.uiDist, dest);
      assertInside(work.root, saved);
      step(`write-live:${rel}`, () => copyFileAtomic(saved, dest));
      const expected = manifest.files[rel].baselineHash;
      const actual = hashFile(dest);
      hashCheck.push({ file: rel, expected, actual, match: expected === actual });
      restored += 1;
    }
    if (!hashCheck.every((h) => h.match)) throw new Error("byteIdentical=false after restore");
    const overlayPath = overlayPathOf(server);
    if (fs.existsSync(overlayPath)) step("remove:overlay", () => fs.unlinkSync(overlayPath));
    if (hasIndexMarker(fs.readFileSync(path.join(server.uiDist, "index.html"), "utf8"))) throw new Error("index marker remains");
    // Keep recovery evidence until all baseline/manifest removal is finished.
    step("remove-workdir", () => {
      for (const rel of Object.keys(inventoryDir(work.root).files)) {
        if (rel === "journal.json" || rel.startsWith("recovery/")) continue;
        step("remove-work-file", () => fs.unlinkSync(path.join(work.root, rel)), { rel });
      }
      for (const rel of Object.keys(inventoryDir(work.root).dirs).sort((a, b) => b.length - a.length)) {
        if (rel === "recovery" || rel.startsWith("recovery/")) continue;
        step("remove-work-directory", () => fs.rmdirSync(path.join(work.root, rel)), { rel });
      }
    });
    journal.recovery = "complete";
    persistJournal(work, journal);
  } catch (err) {
    journal.recovery = "pending";
    transactionFailure({ action: "revert", err, server, work, journal, snapLive, snapWork, createdLive: [], classified });
  }
  finishTransaction(work, journal, warnings, true);

  return {
    ok: true,
    action: "revert",
    changed: restored > 0,
    stateBefore: classified.state,
    stateAfter: STATE.INSTALLED_NOT_APPLIED,
    paperclipVersion: server.version,
    toolVersion: TOOL_VERSION,
    compatible: true,
    targetDir: server.uiDist,
    baselineSafe: true,
    warnings,
    nextAction: NEXT_ACTION.NONE,
    verification: { restored, byteIdentical: true, files: hashCheck },
    error: null,
    message: `Откат выполнен: восстановлено файлов ${restored}, оверлей удалён.`,
  };
}

function rejectPendingJournal(server, work) {
  if (pendingJournal(work)) throwClosed("Незавершённая транзакция: повторите apply/reapply/revert для проверки восстановления.", {
    exitCode: EXIT.CONFLICT, nextAction: NEXT_ACTION.FORCE_MANUAL, server,
    extra: { stateBefore: STATE.CONFLICT_PARTIAL, stateAfter: STATE.CONFLICT_PARTIAL, changed: false, baselineSafe: false, details: { journal: work.journal } },
  });
}

export function verifyInstall({ serverDir, panelResize = false, allowPendingJournal = false } = {}) {
  const server = findServerPackage({ serverDir });
  const work = workPaths(server);
  if (!allowPendingJournal) rejectPendingJournal(server, work);
  const targets = listTargets(server.uiDist);
  const dict = loadDictionary();
  const manifestInspection = inspectManifestFile(work.manifest);
  const live = readLiveMap(server, targets);
  const classified = classifyState({
    server,
    manifestInspection,
    targets,
    live,
    dict,
    panelResize,
    compat: assessCompatibility(server.version),
    work,
  });

  const overlayPath = overlayPathOf(server);
  const indexHtml = live.get("index.html") || "";
  const overlayOk =
    classified.state === STATE.APPLIED_CURRENT &&
    fs.existsSync(overlayPath) &&
    (!manifestInspection.manifest?.overlayHash || hashFile(overlayPath) === manifestInspection.manifest.overlayHash);

  const checks = {
    manifestPresent: manifestInspection.status === "valid",
    manifestStatus: manifestInspection.status,
    overlayPresent: fs.existsSync(overlayPath),
    overlayHashMatch: overlayOk,
    indexMarker: hasIndexMarker(indexHtml),
    hashesMatch: classified.state === STATE.APPLIED_CURRENT,
    dictionaryHash: manifestInspection.manifest?.dictionaryHash === dict.fingerprint,
    schema: manifestInspection.manifest?.schema || null,
  };

  const clean = classified.state === STATE.INSTALLED_NOT_APPLIED;
  const fingerprint = clean ? matchFingerprint({ record: fingerprintRecord(server.version), uiDist: server.uiDist, targets }) : null;
  checks.integrity = classified.state === STATE.APPLIED_CURRENT || classified.state === STATE.APPLIED_STALE;
  checks.cleanFingerprint = fingerprint?.ok ?? null;
  // Undeclared bytes in the owned root are reported, not treated as a conflict:
  // they are stale metadata from an older revision, and reapply prunes them.
  const undeclared = undeclaredOwnedEntries({ server, work, manifest: manifestInspection.manifest });
  checks.undeclaredOwnedPaths = undeclared;
  const ok = (clean && fingerprint?.ok === true)
    || (classified.state === STATE.APPLIED_CURRENT && checks.overlayPresent && checks.indexMarker && overlayOk);
  const conflict = conflictState(classified);
  const warnings = classified.conflicts.map((c) => `${c.file}: ${c.reason}`);
  if (undeclared.length) {
    warnings.push(`Неучтённые файлы внутри ${WORK_DIR_NAME}: ${undeclared.length}. Их удалит reapply.`);
  }
  return {
    ok,
    action: "verify",
    changed: false,
    stateBefore: classified.state,
    stateAfter: classified.state,
    paperclipVersion: server.version,
    toolVersion: TOOL_VERSION,
    compatible: classified.compatible ?? null,
    targetDir: server.uiDist,
    baselineSafe: classified.baselineSafe ?? null,
    warnings,
    nextAction: ok ? NEXT_ACTION.NONE : conflict ? NEXT_ACTION.FORCE_MANUAL : NEXT_ACTION.APPLY,
    verification: { ...checks, conflicts: classified.conflicts },
    error: ok ? null : `Состояние: ${classified.state}`,
    message: ok ? `Целостность подтверждена: ${classified.state}.` : `Состояние: ${classified.state}`,
  };
}

export function inspectStatus({ serverDir, panelResize = false } = {}) {
  let server;
  try {
    server = findServerPackage({ serverDir });
  } catch (err) {
    if (err instanceof ToolError && err.exitCode === EXIT.NOT_FOUND) {
      return {
        ok: false,
        action: "status",
        changed: false,
        stateBefore: STATE.NOT_INSTALLED,
        stateAfter: STATE.NOT_INSTALLED,
        paperclipVersion: null,
        toolVersion: TOOL_VERSION,
        compatible: false,
        targetDir: null,
        baselineSafe: null,
        warnings: [err.message],
        nextAction: NEXT_ACTION.NONE,
        verification: null,
        message: err.message,
        error: err.message,
      };
    }
    throw err;
  }

  const work = workPaths(server);
  rejectPendingJournal(server, work);
  const targets = listTargets(server.uiDist);
  const dict = loadDictionary();
  const stats = dictionaryStats(dict);
  const manifestInspection = inspectManifestFile(work.manifest);
  const live = readLiveMap(server, targets);
  const assessment = assessCompatibility(server.version);
  const classified = classifyState({
    server,
    manifestInspection,
    targets,
    live,
    dict,
    panelResize,
    compat: assessment,
    work,
  });
  const conflict = conflictState(classified);

  return {
    ok: !conflict && classified.state !== STATE.UNSUPPORTED,
    action: "status",
    changed: false,
    stateBefore: classified.state,
    stateAfter: classified.state,
    paperclipVersion: server.version,
    toolVersion: TOOL_VERSION,
    compatible: classified.compatible ?? null,
    targetDir: server.uiDist,
    baselineSafe: classified.baselineSafe ?? null,
    warnings: classified.conflicts.map((c) => `${c.file}: ожидался ${c.expected}, факт ${c.actual}`),
    nextAction:
      classified.state === STATE.APPLIED_CURRENT
        ? NEXT_ACTION.NONE
        : classified.state === STATE.APPLIED_STALE
          ? NEXT_ACTION.REAPPLY
          : conflict
            ? NEXT_ACTION.FORCE_MANUAL
            : classified.state === STATE.UNSUPPORTED
              ? NEXT_ACTION.UPDATE_TOOL
              : NEXT_ACTION.APPLY,
    details: {
      dictionaryEntries: stats.entries,
      rules: stats.rules,
      plurals: stats.plurals,
      dictionaryHash: stats.fingerprint,
      manifest: manifestInspection.manifest,
      manifestStatus: manifestInspection.status,
      support: assessment.support,
      writable: server.writable,
      node: process.version,
    },
    message: `Состояние: ${classified.state}`,
    verification: { conflicts: classified.conflicts },
    error: conflict || classified.state === STATE.UNSUPPORTED ? classified.state : null,
  };
}

export function inspectDoctor({ serverDir, panelResize = false } = {}) {
  const status = inspectStatus({ serverDir, panelResize });
  const compat = loadCompatibility();
  status.action = "doctor";
  status.details = {
    ...(status.details || {}),
    node: process.version,
    platform: process.platform,
    toolNodeRequirement: compat.toolNode,
    paperclipNodeRequirement: compat.paperclipNode,
    currentStable: compat.currentStable,
    compatibility: assessCompatibility(status.paperclipVersion, compat),
  };
  return status;
}

export function listApplyFailpointsFromEnv() {
  return failpointNameSafe();
}

function failpointNameSafe() {
  return process.env.PAPERCLIP_RU_FAILPOINT || "";
}

void classifyFail;
void INDEX_MARKER;
void OVERLAY_FILE;
void posixRel;
