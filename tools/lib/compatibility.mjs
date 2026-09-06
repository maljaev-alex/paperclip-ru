import { readJson } from "./fs-atomic.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_VERSION } from "./constants.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function loadCompatibility() {
  const file = path.join(PROJECT_ROOT, "data", "compatibility.json");
  return readJson(file, {
    schema: "paperclip-ru-compat/v1",
    toolVersion: TOOL_VERSION,
    currentStable: null,
    releases: [],
  });
}

export function assessCompatibility(paperclipVersion, compat = loadCompatibility()) {
  if (!paperclipVersion || paperclipVersion === "unknown") {
    return {
      compatible: false,
      support: "unknown",
      reason: "Версия Paperclip неизвестна.",
      currentStable: compat.currentStable ?? null,
    };
  }
  const prerelease = /-(canary|nightly|beta|dev|rc)/i.test(paperclipVersion);
  const listed = (compat.releases || []).find((r) => r.version === paperclipVersion);
  if (prerelease && !listed) {
    return {
      compatible: false,
      support: "unsupported",
      reason: "Canary/commit/prerelease сборки не поддерживаются, пока явно не проверены.",
      currentStable: compat.currentStable ?? null,
    };
  }
  if (listed) {
    const compatible = listed.support === "full" || listed.support === "best-effort";
    return {
      compatible,
      support: listed.support,
      reason: listed.notes || null,
      currentStable: compat.currentStable ?? null,
      synthetic: Boolean(listed.synthetic),
      experimental: listed.support === "experimental",
    };
  }
  return {
    compatible: false,
    support: "unsupported",
    reason: `Версия ${paperclipVersion} отсутствует в матрице совместимости. Текущая stable: ${compat.currentStable}.`,
    currentStable: compat.currentStable ?? null,
  };
}
