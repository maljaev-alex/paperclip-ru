#!/usr/bin/env node
import { buildRelease, listNpmPackFiles } from "./lib/release-builder.mjs";

const dry = process.argv.includes("--dry-run");
const check = process.argv.includes("--check");

try {
  const files = listNpmPackFiles();
  console.log(`npm pack files: ${files.length}`);
  if (check && !dry && !process.argv.includes("--build") && process.argv.includes("--inventory-only")) {
    process.exit(0);
  }
  const result = buildRelease({ dryRun: dry });
  console.log(`release assets: ${result.zipPath}`);
  console.log(`release assets: ${result.tarPath}`);
  console.log(`release manifest: ${result.manifestPath}`);
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
