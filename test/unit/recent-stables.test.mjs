import test from "node:test";
import assert from "node:assert/strict";
import { recentStableVersions, validateCompatibilityWindow } from "../../tools/recent-stables.mjs";
import { fingerprintFromFiles } from "../../tools/lib/fingerprints.mjs";

test("recent stable window excludes prereleases, old releases and future timestamps", () => {
  const recent = recentStableVersions([{
    "2026.801.0": "2026-08-01T00:00:00.000Z",
    "2026.807.0": "2026-08-07T12:00:00.000Z",
    "2026.831.0-canary.1": "2026-08-31T01:00:00.000Z",
    "2026.901.0": "2026-09-01T00:00:00.000Z",
    "2026.907.0": "2026-09-07T00:00:00.000Z",
  }], { days: 30, now: new Date("2026-09-06T12:00:00.000Z") });
  assert.deepEqual(recent, [
    { version: "2026.901.0", publishedAt: "2026-09-01T00:00:00.000Z" },
    { version: "2026.807.0", publishedAt: "2026-08-07T12:00:00.000Z" },
  ]);
});

test("compatibility window requires declared releases and consistent fingerprints", () => {
  const files = { "index.html": "a".repeat(64) };
  const recent = [{ version: "2026.901.0", publishedAt: "2026-09-01T00:00:00.000Z" }];
  const compatibility = {
    currentStable: "2026.901.0",
    recentStableVersions: ["2026.901.0"],
    policy: { recentStableWindowDays: 30 },
    releases: [{ version: "2026.901.0", publishedAt: recent[0].publishedAt, support: "full", tested: "2026-09-06" }],
  };
  const fingerprints = { versions: { "2026.901.0": {
    files,
    fileCount: 1,
    fingerprint: fingerprintFromFiles(files),
    packageIntegrity: `sha512-${Buffer.from("official-package").toString("base64")}`,
  } } };
  assert.deepEqual(validateCompatibilityWindow(recent, compatibility, fingerprints, { days: 30 }), []);
  compatibility.releases[0].tested = null;
  assert.match(validateCompatibilityWindow(recent, compatibility, fingerprints, { days: 30 }).join("; "), /tested date/);
});
