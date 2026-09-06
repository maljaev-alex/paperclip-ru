/**
 * Stable machine-readable result contract for lifecycle commands.
 * In --json mode stdout is a single JSON document; diagnostics go to stderr.
 * Unknown safety fields stay null — never default compatible/baselineSafe to true.
 */

function has(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

export function emitResult(opts, result, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const doc = normalizeResult(result);
  if (opts.json) {
    stdout.write(`${JSON.stringify(doc)}\n`);
  } else if (typeof opts.formatHuman === "function") {
    opts.formatHuman(doc, { stdout, stderr });
  }
  return doc;
}

export function logHuman(opts, ...parts) {
  if (opts.json) return;
  console.log(...parts);
}

export function logWarn(opts, ...parts) {
  if (opts.json) {
    console.error(...parts);
    return;
  }
  console.log(...parts);
}

export function normalizeResult(result = {}) {
  const doc = {
    ok: Boolean(result.ok),
    action: has(result, "action") ? result.action : "unknown",
    changed: Boolean(result.changed),
    stateBefore: has(result, "stateBefore") ? result.stateBefore : null,
    stateAfter: has(result, "stateAfter") ? result.stateAfter : has(result, "stateBefore") ? result.stateBefore : null,
    paperclipVersion: has(result, "paperclipVersion") ? result.paperclipVersion : null,
    toolVersion: has(result, "toolVersion") ? result.toolVersion : null,
    compatible: has(result, "compatible") ? result.compatible : null,
    targetDir: has(result, "targetDir") ? result.targetDir : null,
    baselineSafe: has(result, "baselineSafe") ? result.baselineSafe : null,
    verification: has(result, "verification") ? result.verification : null,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    nextAction: has(result, "nextAction") ? result.nextAction : "none",
    error: result.error == null ? null : result.error,
  };
  if (has(result, "files")) doc.files = result.files;
  if (has(result, "risks")) doc.risks = result.risks;
  if (has(result, "message")) doc.message = result.message;
  if (has(result, "details")) doc.details = result.details;
  if (has(result, "child")) doc.child = result.child;
  if (has(result, "installedVersion")) doc.installedVersion = result.installedVersion;
  if (has(result, "selectedVersion")) doc.selectedVersion = result.selectedVersion;
  return doc;
}
