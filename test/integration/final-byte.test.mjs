import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { assertInventoryUnchanged, createTestRoot, makeTempServer, treeHashes, treeInventory } from "../helpers/copy-fixture.mjs";
import { buildRelease, listNpmPackFiles, publishableAssetNames } from "../../tools/lib/release-builder.mjs";
import { installRuntimeDeps, writeOwnershipMarker } from "../../tools/lib/lifecycle.mjs";
import { extractZipToDirectory } from "../../tools/lib/zip-write.mjs";
import { readZipEntries } from "../../tools/lib/archive-read.mjs";
import { PROJECT_ROOT } from "../../tools/lib/dictionary.mjs";
import { sha256 } from "../../tools/lib/fs-atomic.mjs";
import { TOOL_VERSION } from "../../tools/lib/constants.mjs";

function jsonOut(res) {
  return JSON.parse(res.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
}

function verifyChecksum(dir, asset) {
  const sums = fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8");
  const line = sums.split(/\r?\n/).find((l) => l.endsWith(`  ${asset}`));
  assert.ok(line, `SHA256SUMS: ${asset}`);
  const expected = line.slice(0, 64).toLowerCase();
  const actual = sha256(fs.readFileSync(path.join(dir, asset)));
  assert.equal(actual, expected, asset);
}

function assertSingleJson(res) {
  const docs = res.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(docs.length, 1, res.stdout);
  JSON.parse(docs[0]);
}

function runInstalled(installDir, args, extra = {}) {
  return new Promise((resolve) => {
    const cli = path.join(installDir, "tools", "paperclip-ru.mjs");
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: path.dirname(installDir),
      env: {
        ...process.env,
        NO_COLOR: "1",
        NODE_PATH: path.join(installDir, "node_modules"),
        ...(extra.env || {}),
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("release contains the complete tracked contributor snapshot and no intermediate inputs", (t) => {
  const root = createTestRoot("release-inventory", t);
  const dist = path.join(root, "dist");
  const built = buildRelease({ testBuild: true, outDir: dist });
  assert.deepEqual(fs.readdirSync(dist).sort(), publishableAssetNames().sort());
  assert.deepEqual(built.manifest.assets.map((asset) => asset.name).sort(), [
    `paperclip-ru-${TOOL_VERSION}.tar.gz`,
    `paperclip-ru-${TOOL_VERSION}.zip`,
  ]);

  const entries = readZipEntries(built.zipPath).map((entry) => entry.name);
  const payloadFiles = entries
    .filter((name) => name.startsWith("paperclip-ru/") && !name.endsWith("/") && name !== "paperclip-ru/artifact-manifest.json")
    .map((name) => name.slice("paperclip-ru/".length))
    .sort();
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: PROJECT_ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((name) => name.replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(payloadFiles, trackedFiles, "Release archive must contain every tracked file exactly once");

  const npmPackFiles = listNpmPackFiles();
  for (const required of [
    "test/unit/dictionary.test.mjs",
    "tools/lint-dictionary.mjs",
    "tools/pack-release.mjs",
    "data/lint-warning-baseline.json",
    "docs/ARCHITECTURE.md",
    "CONTRIBUTING.md",
  ]) {
    assert.ok(npmPackFiles.includes(required), `npm pack contributor file: ${required}`);
    assert.ok(entries.includes(`paperclip-ru/${required}`), `release contributor file: ${required}`);
  }
  for (const forbidden of [
    "paperclip-ru/locales/parts/",
    "paperclip-ru/work/",
    "paperclip-ru/docs/audits/",
    "paperclip-ru/docs/AGENT-HANDOFF.md",
    "paperclip-ru/docs/CHAT-EXPORT.md",
  ]) {
    assert.equal(entries.some((name) => name === forbidden || name.startsWith(forbidden)), false, forbidden);
  }
});

for (const asset of [`paperclip-ru-${TOOL_VERSION}.zip`, `paperclip-ru-${TOOL_VERSION}.tar.gz`]) {
  test(`final-byte lifecycle ${asset}`, async (t) => {
    const root = createTestRoot(`final-${asset.includes("zip") ? "zip" : "tar"}`, t);
    const preset = process.env.PAPERCLIP_RU_DIST_DIR;
    if (preset) {
      assert.ok(fs.existsSync(path.join(preset, asset)), 'Explicit release assets must exist; fixture fallback is forbidden');
      assert.equal(JSON.parse(fs.readFileSync(path.join(preset, 'release-manifest.json'))).testBuild, false, 'A release gate must use publishable bytes');
    }
    const dist = preset && fs.existsSync(preset) ? preset : path.join(root, "dist");
    const built = preset && fs.existsSync(path.join(preset, asset))
      ? { zipPath: path.join(preset, `paperclip-ru-${TOOL_VERSION}.zip`), tarPath: path.join(preset, `paperclip-ru-${TOOL_VERSION}.tar.gz`) }
      : buildRelease({ testBuild: true, outDir: dist });
    assert.ok(fs.existsSync(built.zipPath));
    assert.ok(fs.existsSync(built.tarPath));
    verifyChecksum(dist, asset);
    verifyChecksum(dist, "release-manifest.json");
    const detached = JSON.parse(fs.readFileSync(path.join(dist, "release-manifest.json"), "utf8"));
    assert.equal(detached.toolVersion, TOOL_VERSION);
    assert.match(detached.artifactManifestSha256, /^[a-f0-9]{64}$/i);

    const unpacked = path.join(root, "unpacked");
    fs.mkdirSync(unpacked, { recursive: true });
    const archive = path.join(dist, asset);
    if (asset.endsWith(".zip")) extractZipToDirectory(archive, unpacked);
    else execFileSync("tar", ["-xzf", archive, "-C", unpacked], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const tool = path.join(unpacked, "paperclip-ru", "tools", "paperclip-ru.mjs");
    assert.equal(fs.existsSync(tool), true);
    assert.equal(fs.existsSync(path.join(unpacked, "tools", "paperclip-ru.mjs")), false);
    const artFile = path.join(unpacked, "paperclip-ru", "artifact-manifest.json");
    assert.equal(sha256(fs.readFileSync(artFile)), detached.artifactManifestSha256);

    const extractedRoot = path.join(unpacked, "paperclip-ru");
    installRuntimeDeps(extractedRoot);
    const server = makeTempServer({ label: `fb-srv-${asset.includes("zip") ? "z" : "t"}`, t });
    const installDir = path.join(root, "install");
    const install = await runInstalled(extractedRoot, [
      "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server, "--asset", asset,
    ]);
    assertSingleJson(install);
    const installed = jsonOut(install);
    assert.equal(install.code, 0, install.stderr + install.stdout);
    assert.equal(installed.ok, true);
    assert.equal(installed.stateAfter, "applied/current");
    assert.equal(installed.error, null);
    assert.ok(fs.existsSync(path.join(installDir, "tools", "paperclip-ru.mjs")));
    assert.ok(fs.existsSync(path.join(installDir, "test", "unit", "dictionary.test.mjs")));
    assert.ok(fs.existsSync(path.join(installDir, "CONTRIBUTING.md")));

    const doctor = await runInstalled(installDir, ["doctor", "--json", "--server-dir", server]);
    assertSingleJson(doctor);
    assert.equal(jsonOut(doctor).ok, true);

    const dryRes = await runInstalled(installDir, ["apply", "--dry-run", "--json", "--server-dir", server]);
    assertSingleJson(dryRes);
    const dry = jsonOut(dryRes);
    assert.equal(dry.changed, false);

    const againRes = await runInstalled(installDir, ["apply", "--json", "--server-dir", server]);
    assertSingleJson(againRes);
    const again = jsonOut(againRes);
    assert.equal(again.ok, true);
    assert.equal(again.changed, false);
    assert.equal(again.stateAfter, "applied/current");

    const verifyRes = await runInstalled(installDir, ["verify", "--json", "--server-dir", server]);
    assertSingleJson(verifyRes);
    const verify = jsonOut(verifyRes);
    assert.equal(verify.ok, true);

    const ui = path.join(server, "ui-dist");
    const beforeFail = treeInventory(ui);
    fs.appendFileSync(path.join(installDir, "tools", "paperclip-ru.mjs"), "\n// previous-root-stamp\n");
    writeOwnershipMarker(installDir);
    const beforeCli = fs.readFileSync(path.join(installDir, "tools", "paperclip-ru.mjs"));
    const beforePkg = fs.readFileSync(path.join(installDir, "package.json"));
    const failedUpdate = await runInstalled(installDir, [
      "update", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server, "--asset", asset,
    ], { env: { PAPERCLIP_RU_FAILPOINT: "cli:apply" } });
    assertSingleJson(failedUpdate);
    assert.notEqual(failedUpdate.code, 0, failedUpdate.stdout);
    assert.equal(jsonOut(failedUpdate).ok, false);
    assert.ok(fs.existsSync(path.join(installDir, "tools", "paperclip-ru.mjs")));
    assert.equal(fs.existsSync(`${installDir}.prev`), false);
    assert.deepEqual(fs.readFileSync(path.join(installDir, "tools", "paperclip-ru.mjs")), beforeCli);
    assert.deepEqual(fs.readFileSync(path.join(installDir, "package.json")), beforePkg);
    const afterFailRes = await runInstalled(installDir, ["verify", "--json", "--server-dir", server]);
    assertSingleJson(afterFailRes);
    const afterFail = jsonOut(afterFailRes);
    assert.equal(afterFail.ok, true, afterFail.error);
    assertInventoryUnchanged(beforeFail, ui);

    const baselineHashes = treeHashes(path.join(ui, ".paperclip-ru", "baseline"));
    const revertRes = await runInstalled(installDir, ["revert", "--json", "--server-dir", server]);
    assertSingleJson(revertRes);
    const reverted = jsonOut(revertRes);
    assert.equal(reverted.ok, true);
    assert.equal(reverted.verification.byteIdentical, true);
    for (const [rel, hash] of Object.entries(baselineHashes)) {
      assert.equal(sha256(fs.readFileSync(path.join(ui, rel))), hash, `revert live ${rel}`);
    }
    assert.equal(fs.existsSync(path.join(ui, "assets", "paperclip-ru-overlay.js")), false);
    assert.equal(fs.existsSync(path.join(ui, ".paperclip-ru")), false);

    const uninstall = await runInstalled(installDir, [
      "uninstall", "--json", "--install-dir", installDir, "--server-dir", server,
    ]);
    assertSingleJson(uninstall);
    const gone = jsonOut(uninstall);
    assert.equal(uninstall.code, 0, uninstall.stderr + uninstall.stdout);
    assert.equal(gone.ok, true);
    assert.equal(fs.existsSync(installDir), false);
  });
}
