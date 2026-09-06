import fs from "node:fs";
import path from "node:path";
import { EXIT, NEXT_ACTION, TOOL_VERSION, COMMANDS } from "./constants.mjs";
import { ToolError, ensureDir } from "./fs-atomic.mjs";
import { parseArgv, usageText } from "./args.mjs";
import { emitResult, logHuman } from "./json-result.mjs";
import { findServerPackage, listTargets, workPaths } from "./paths.mjs";
import { loadDictionary, dictionaryStats, WORK_OUT_DIR } from "./dictionary.mjs";
import { extractOccurrences, looksLikeUiText, plausibleLabel, UI_KEYS } from "./strings.mjs";
import { inspectDoctor, inspectStatus, runApply, runRevert, verifyInstall } from "./apply.mjs";
import { buildCoverageReport } from "./coverage.mjs";
import { runInstall, runUninstall, runUpdate } from "./lifecycle.mjs";

function printUsage(opts) {
  const text = usageText();
  if (opts.json) {
    return emitResult(opts, {
      ok: true,
      action: "help",
      changed: false,
      toolVersion: TOOL_VERSION,
      nextAction: NEXT_ACTION.NONE,
      message: text,
    });
  }
  console.log(text);
  return { ok: true };
}

function cmdExtract(opts) {
  const server = findServerPackage({ serverDir: opts.serverDir });
  const work = workPaths(server);
  const targets = listTargets(server.uiDist).filter((t) => t.endsWith(".js"));
  const dict = loadDictionary();
  const useBaseline = fs.existsSync(work.baseline) && !opts.live;

  const byValue = new Map();
  for (const rel of targets) {
    const file =
      useBaseline && fs.existsSync(path.join(work.baseline, rel))
        ? path.join(work.baseline, rel)
        : path.join(server.uiDist, rel);
    let occurrences;
    try {
      occurrences = extractOccurrences(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const occ of occurrences) {
      if (occ.block) continue;
      const prose = looksLikeUiText(occ.value);
      const labelled = UI_KEYS.has(occ.propKey) && plausibleLabel(occ.value);
      if (!prose && !labelled) continue;
      const rec = byValue.get(occ.value) || { value: occ.value, count: 0, keys: new Set(), files: new Set() };
      rec.count += 1;
      if (occ.propKey) rec.keys.add(occ.propKey);
      rec.files.add(rel);
      byValue.set(occ.value, rec);
    }
  }

  const all = [...byValue.values()]
    .map((r) => ({ value: r.value, count: r.count, keys: [...r.keys].sort(), files: [...r.files].sort() }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const missing = all.filter((r) => !dict.exact.has(r.value));

  const payload = {
    source: useBaseline ? "baseline" : "live",
    candidates: all.length,
    missing: missing.length,
    missingValues: missing.map((r) => r.value),
  };

  if (opts.json && !opts.output) {
    return {
      ok: true,
      action: "extract",
      changed: false,
      paperclipVersion: server.version,
      toolVersion: TOOL_VERSION,
      compatible: true,
      targetDir: server.uiDist,
      baselineSafe: true,
      nextAction: NEXT_ACTION.NONE,
      details: payload,
      error: null,
      message: `Кандидатов: ${all.length}, без перевода: ${missing.length}`,
    };
  }

  const outDir = opts.output ? path.dirname(path.resolve(opts.output)) : WORK_OUT_DIR;
  ensureDir(outDir);
  const missingPath = opts.output ? path.resolve(opts.output) : path.join(WORK_OUT_DIR, "missing.json");
  fs.writeFileSync(missingPath, JSON.stringify(missing, null, 2));
  if (!opts.output) {
    fs.writeFileSync(path.join(WORK_OUT_DIR, "strings.json"), JSON.stringify(all, null, 2));
    fs.writeFileSync(
      path.join(WORK_OUT_DIR, "missing.template.json"),
      JSON.stringify(Object.fromEntries(missing.map((r) => [r.value, ""])), null, 2)
    );
  }

  return {
    ok: true,
    action: "extract",
    changed: true,
    paperclipVersion: server.version,
    toolVersion: TOOL_VERSION,
    compatible: true,
    targetDir: server.uiDist,
    baselineSafe: true,
    nextAction: NEXT_ACTION.NONE,
    details: { ...payload, output: missingPath },
    message: `Кандидатов: ${all.length}, без перевода: ${missing.length}. Записано: ${missingPath}`,
  };
}

function cmdReport(opts) {
  const status = inspectStatus({ serverDir: opts.serverDir, panelResize: opts.panelResize });
  const coverage = buildCoverageReport({ serverDir: opts.serverDir, routeMatrix: opts.routeMatrix });
  const payload = { status, coverage };
  if (opts.output) {
    ensureDir(path.dirname(path.resolve(opts.output)));
    fs.writeFileSync(path.resolve(opts.output), JSON.stringify(payload, null, 2));
  }
  return {
    ok: status.ok,
    action: "report",
    changed: Boolean(opts.output),
    stateBefore: status.stateBefore,
    stateAfter: status.stateAfter,
    paperclipVersion: status.paperclipVersion,
    toolVersion: TOOL_VERSION,
    compatible: status.compatible,
    targetDir: status.targetDir,
    baselineSafe: status.baselineSafe,
    warnings: status.warnings,
    nextAction: status.nextAction,
    details: payload,
    error: status.ok ? null : status.error ?? `Состояние: ${status.stateAfter}`,
    message: "coverage + status",
  };
}

function formatHuman(doc, { stdout }) {
  const lines = [];
  if (doc.message) lines.push(doc.message);
  const stateLine = doc.stateAfter ? `Состояние: ${doc.stateAfter}` : null;
  if (stateLine && doc.message !== stateLine) lines.push(stateLine);
  if (doc.paperclipVersion) lines.push(`Paperclip: ${doc.paperclipVersion}`);
  if (doc.targetDir) lines.push(`Каталог UI: ${doc.targetDir}`);
  if (doc.details?.dictionaryEntries != null) {
    lines.push(`Словарь: ${doc.details.dictionaryEntries} строк, правил ${doc.details.rules ?? "?"}`);
  }
  if (doc.warnings?.length) {
    // A failure that is reported as a result often repeats the same sentence as
    // message, warning and error; print it once.
    for (const w of doc.warnings) {
      if (w !== doc.message && w !== doc.error) lines.push(`  ! ${w}`);
    }
  }
  if (doc.files && (doc.action === "apply" || doc.action === "reapply")) {
    const changed = (doc.files || []).filter((f) => f.changed);
    for (const f of changed.slice(0, 30)) {
      lines.push(`  + ${f.file}: ${f.replacements ?? 0} замен`);
    }
  }
  if (doc.risks?.length) {
    for (const r of doc.risks) lines.push(`  ~ ${r}`);
  }
  // The error line belongs on stderr; main() writes it there for both the
  // thrown and the result-shaped failure paths.
  stdout.write(`${lines.filter(Boolean).join("\n")}\n`);
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    if (err instanceof ToolError && err.exitCode === EXIT.USAGE) {
      const wantJson = argv.includes("--json");
      if (wantJson) {
        emitResult({ json: true }, {
          ok: false,
          action: "usage",
          changed: false,
          toolVersion: TOOL_VERSION,
          nextAction: NEXT_ACTION.NONE,
          error: err.message,
        });
      } else {
        console.error(err.message);
      }
      return EXIT.USAGE;
    }
    throw err;
  }

  const opts = parsed.flags;
  opts.formatHuman = formatHuman;

  try {
    if (opts.help) {
      printUsage(opts);
      return EXIT.OK;
    }
    if (parsed.command === "version" || opts.version) {
      if (opts.json) {
        emitResult(opts, { ok: true, action: "version", toolVersion: TOOL_VERSION, changed: false, nextAction: NEXT_ACTION.NONE });
      } else {
        console.log(TOOL_VERSION);
      }
      return EXIT.OK;
    }

    let result;
    switch (parsed.command) {
      case "help":
        printUsage(opts);
        return EXIT.OK;
      case "doctor":
        result = inspectDoctor({ serverDir: opts.serverDir, panelResize: opts.panelResize });
        break;
      case "status":
        result = inspectStatus({ serverDir: opts.serverDir, panelResize: opts.panelResize });
        break;
      case "verify":
        result = verifyInstall({ serverDir: opts.serverDir, panelResize: opts.panelResize });
        break;
      case "apply":
        result = runApply({
          serverDir: opts.serverDir,
          dryRun: opts.dryRun,
          panelResize: opts.panelResize,
          forceBaseline: opts.forceBaseline,
          reapply: false,
        });
        break;
      case "reapply":
        result = runApply({
          serverDir: opts.serverDir,
          dryRun: opts.dryRun,
          panelResize: opts.panelResize,
          forceBaseline: false,
          reapply: true,
        });
        break;
      case "revert":
        result = runRevert({
          serverDir: opts.serverDir,
          dryRun: opts.dryRun,
          force: opts.force,
        });
        break;
      case "extract":
        result = cmdExtract(opts);
        break;
      case "report":
        result = cmdReport(opts);
        break;
      case "install":
        result = await runInstall(opts);
        break;
      case "update":
        result = await runUpdate(opts);
        break;
      case "uninstall":
        result = await runUninstall(opts);
        break;
      default:
        throw new ToolError(`Неизвестная команда: ${parsed.command}`, { exitCode: EXIT.USAGE });
    }

    emitResult(opts, result);
    if (!result.ok) {
      // Commands that turn a failure into an ok:false result never reach the
      // catch block, so the diagnostic line is emitted here instead.
      if (!opts.json && result.error) console.error(`Ошибка: ${result.error}`);
      const state = String(result.stateAfter || "");
      if (state === "conflict" || state === "conflict/partial") return EXIT.CONFLICT;
      if (state === "unsupported") return EXIT.UNSUPPORTED;
      if (state === "not_installed") return EXIT.NOT_FOUND;
      return EXIT.ERROR;
    }
    return EXIT.OK;
  } catch (err) {
    const exitCode = err instanceof ToolError ? err.exitCode : EXIT.ERROR;
    const payload = {
      ok: false,
      action: parsed.command,
      changed: false,
      stateBefore: null,
      stateAfter: null,
      paperclipVersion: null,
      toolVersion: TOOL_VERSION,
      compatible: null,
      targetDir: null,
      baselineSafe: null,
      verification: null,
      warnings: [],
      nextAction: err instanceof ToolError ? err.nextAction : NEXT_ACTION.NONE,
      error: err.message,
      ...(err instanceof ToolError && err.result ? err.result : {}),
      action: parsed.command,
      details: err instanceof ToolError ? err.details ?? err.result?.details : undefined,
    };
    emitResult(opts, payload);
    if (!opts.json) {
      console.error(`Ошибка: ${err.message}`);
    }
    return exitCode;
  }
}

void COMMANDS;
void logHuman;
