#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fingerprintFromFiles } from "./lib/fingerprints.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

function timeObject(value) {
  if (Array.isArray(value)) return value[0] || {};
  return value && typeof value === "object" ? value : {};
}

export function recentStableVersions(timeData, { days = 30, now = new Date() } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("days must be an integer from 1 to 365");
  const upper = new Date(now).getTime();
  if (!Number.isFinite(upper)) throw new Error("Invalid compatibility reference time");
  const lower = upper - days * 24 * 60 * 60 * 1000;
  return Object.entries(timeObject(timeData))
    .filter(([version]) => STABLE_VERSION.test(version))
    .map(([version, published]) => ({ version, publishedAt: new Date(published).toISOString() }))
    .filter((entry) => {
      const published = Date.parse(entry.publishedAt);
      return published >= lower && published <= upper;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.version.localeCompare(a.version));
}

export function validateCompatibilityWindow(recent, compatibility, fingerprints, { days = 30 } = {}) {
  const errors = [];
  const versions = recent.map((entry) => entry.version);
  if (compatibility?.policy?.recentStableWindowDays !== days) {
    errors.push(`policy.recentStableWindowDays must be ${days}`);
  }
  if (JSON.stringify(compatibility?.recentStableVersions || []) !== JSON.stringify(versions)) {
    errors.push(`recentStableVersions differs from npm: ${versions.join(", ")}`);
  }
  if (versions.length && compatibility?.currentStable !== versions[0]) {
    errors.push(`currentStable ${compatibility?.currentStable ?? "<missing>"} != ${versions[0]}`);
  }

  for (const entry of recent) {
    const declared = (compatibility?.releases || []).find((release) => release.version === entry.version);
    if (!declared || !["full", "best-effort"].includes(declared.support)) {
      errors.push(`${entry.version}: supported release record is missing`);
    } else {
      if (!declared.tested) errors.push(`${entry.version}: tested date is missing`);
      if (declared.publishedAt !== entry.publishedAt) errors.push(`${entry.version}: publishedAt differs from npm`);
    }
    const fingerprint = fingerprints?.versions?.[entry.version];
    if (!fingerprint?.files || !Object.keys(fingerprint.files).length) {
      errors.push(`${entry.version}: official ui-dist fingerprint is missing`);
      continue;
    }
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(fingerprint.packageIntegrity || "")) {
      errors.push(`${entry.version}: npm package integrity is missing`);
    }
    if (fingerprint.fileCount !== Object.keys(fingerprint.files).length) {
      errors.push(`${entry.version}: fingerprint fileCount is inconsistent`);
    }
    if (fingerprint.fingerprint !== fingerprintFromFiles(fingerprint.files)) {
      errors.push(`${entry.version}: fingerprint digest is inconsistent`);
    }
  }
  return errors;
}

function registryTimes() {
  const opts = { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
  const output = process.platform === "win32"
    ? execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", "view", "@paperclipai/server", "time", "--json"], opts)
    : execFileSync("npm", ["view", "@paperclipai/server", "time", "--json"], opts);
  return JSON.parse(output);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const days = Number(argValue("--days", "30"));
  const now = new Date(process.env.PAPERCLIP_COMPAT_NOW || Date.now());
  const recent = recentStableVersions(registryTimes(), { days, now });
  if (!recent.length) throw new Error(`npm returned no stable Paperclip releases for the last ${days} days`);
  if (process.argv.includes("--check")) {
    const compatibility = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "data", "compatibility.json"), "utf8"));
    const fingerprints = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "data", "fingerprints.json"), "utf8"));
    const errors = validateCompatibilityWindow(recent, compatibility, fingerprints, { days });
    if (errors.length) throw new Error(errors.join("; "));
  }
  console.log(JSON.stringify(process.argv.includes("--details") ? recent : recent.map((entry) => entry.version)));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
