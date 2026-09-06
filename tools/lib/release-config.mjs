import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function loadReleaseConfig() {
  const file = path.join(PROJECT_ROOT, "data", "release-config.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  return raw;
}

export function repositorySlug(override) {
  if (override) return override;
  const cfg = loadReleaseConfig();
  return cfg.repository || null;
}
