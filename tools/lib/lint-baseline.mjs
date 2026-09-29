import { createHash } from "node:crypto";

export function findingId({ code, en, ru, message }) {
  return createHash("sha256").update(JSON.stringify([code, en, ru, message])).digest("hex");
}

// A count ceiling lets a new defect replace a removed finding undetected.
// Only the exact diagnostic and translation accepted in the baseline may pass.
export function applyLintBaseline(result, baseline) {
  if (baseline?.schema !== "paperclip-ru-lint-warning-baseline/v2" ||
      !/^[a-f0-9]{40}$/.test(baseline.sourceCommit ?? "") ||
      !Array.isArray(baseline.accepted)) {
    throw new Error("Invalid exact lint baseline");
  }
  const known = new Map();
  for (const item of baseline.accepted) {
    if (!/^[a-f0-9]{64}$/.test(item?.id ?? "") ||
        typeof item.code !== "string" || !item.code ||
        typeof item.en !== "string" ||
        typeof item.reason !== "string" || !item.reason.trim() || known.has(item.id)) {
      throw new Error("Invalid or duplicate lint baseline entry");
    }
    known.set(item.id, item);
  }
  const warning = [];
  const accepted = [];
  for (const issue of result.issues.warning) {
    const record = known.get(findingId(issue));
    if (record && record.code === issue.code && record.en === issue.en) {
      accepted.push({ ...issue, reason: record.reason });
    } else {
      warning.push(issue);
    }
  }
  return {
    ...result,
    counts: { ...result.counts, warning: warning.length, accepted: accepted.length },
    // Preserve the raw diagnostics explicitly for dictionary maintenance.
    rawCounts: { ...result.counts },
    issues: { ...result.issues, warning, accepted },
    baseline: { schema: baseline.schema, sourceCommit: baseline.sourceCommit },
  };
}
