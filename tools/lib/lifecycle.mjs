import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ARCHIVE_ROOT, EXIT, INSTALL_MARKER, NEXT_ACTION, STATE, TOOL_NAME, TOOL_VERSION } from "./constants.mjs";
import { ToolError, assertInside, atomicWriteFile, ensureDir, hashFile, sha256 } from "./fs-atomic.mjs";
import { assertSafeInstallDir, defaultInstallDir } from "./safe-install-path.mjs";
import { repositorySlug } from "./release-config.mjs";
import { PROJECT_ROOT } from "./dictionary.mjs";
import { createTempDir, verifyChecksumForFile } from "./release-builder.mjs";
import { hit } from "./failpoints.mjs";
import { extractReleaseArchive } from "./archive-read.mjs";
import { findServerPackage } from "./paths.mjs";
import { treeInventory as snapshotInventory, compareTree, removeTree } from "./tree-snapshot.mjs";
import { lifecycleJournalPath, readLifecycleJournal, recoverLifecycle, createLifecycleTransaction, prepareLifecycleSnapshots, rollbackLifecycle, commitLifecycle } from "./lifecycle-transaction.mjs";
export { lifecycleJournalPath, readLifecycleJournal };

const TEXT_BOUND = 4000;

function boundText(value, max = TEXT_BOUND) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function emptyLifecycle(action, extra = {}) {
  return {
    ok: extra.ok ?? false,
    action,
    changed: extra.changed ?? false,
    stateBefore: extra.stateBefore ?? null,
    stateAfter: extra.stateAfter ?? null,
    paperclipVersion: extra.paperclipVersion ?? null,
    toolVersion: extra.toolVersion ?? TOOL_VERSION,
    compatible: extra.compatible ?? null,
    targetDir: extra.targetDir ?? null,
    baselineSafe: extra.baselineSafe ?? null,
    verification: extra.verification ?? null,
    warnings: extra.warnings ?? [],
    nextAction: extra.nextAction ?? NEXT_ACTION.REPORT,
    error: extra.error ?? null,
    child: extra.child,
    details: extra.details,
    message: extra.message,
  };
}

function throwLifecycle(message, { exitCode = EXIT.ERROR, action, extra = {} } = {}) {
  throw new ToolError(message, {
    exitCode,
    nextAction: extra.nextAction ?? NEXT_ACTION.REPORT,
    details: extra.details ?? null,
    result: emptyLifecycle(action, { ...extra, error: message }),
  });
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function childView(step) {
  if (!step) return null;
  return {
    ok: Boolean(step.ok),
    exitCode: step.exitCode ?? null,
    result: step.result ?? null,
    stdout: boundText(step.stdout),
    stderr: boundText(step.stderr),
  };
}

function inventoryTree(root) {
  const files = {};
  const walk = (dir, relBase) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const posixRel = rel.replace(/\\/g, "/");
      const p = path.join(dir, ent.name);
      if (posixRel === INSTALL_MARKER) continue;
      if (ent.isSymbolicLink()) {
        throw new Error(`reparse/symlink: ${rel}`);
      }
      if (ent.isDirectory()) walk(p, rel);
      else {
        const st = fs.lstatSync(p);
        files[rel] = { hash: hashFile(p), size: st.size };
      }
    }
  };
  walk(root, "");
  return files;
}

export function assertReleaseVersion(value) {
  const raw = value == null || value === "" ? "stable" : String(value);
  if (raw === "stable") return "stable";
  const semver = raw.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(semver)) {
    throw new ToolError("--release-version принимает только stable, v<semver> или <semver>.", { exitCode: EXIT.USAGE });
  }
  return semver;
}

export function writeOwnershipMarker(installDir, extra = {}) {
  const pkg = readJsonSafe(path.join(installDir, "package.json"));
  const marker = {
    schema: "paperclip-ru-install/v1",
    tool: TOOL_NAME,
    toolVersion: extra.toolVersion || pkg?.version || TOOL_VERSION,
    createdAt: new Date().toISOString(),
    ownedAllowlist: [
      INSTALL_MARKER, ".github", ".gitattributes", ".gitignore",
      "tools", "locales", "scripts", "data", "docs", "test",
      "package.json", "package-lock.json", "README.md", "README.en.md",
      "LICENSE", "SECURITY.md", "AGENTS.md", "CONTRIBUTING.md", "node_modules",
      "artifact-manifest.json",
      ".npmrc",
    ],
    ownedInventory: extra.ownedInventory || inventoryTree(installDir),
    ownedDirectories: Object.keys(snapshotInventory(installDir).dirs).filter(Boolean),
    ...extra,
  };
  atomicWriteFile(path.join(installDir, INSTALL_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}

export function readOwnershipMarker(installDir) {
  const file = path.join(installDir, INSTALL_MARKER);
  if (!fs.existsSync(file)) return null;
  const raw = readJsonSafe(file);
  if (!raw || raw.schema !== "paperclip-ru-install/v1" || raw.tool !== TOOL_NAME) return null;
  if (!Array.isArray(raw.ownedAllowlist) || !raw.ownedAllowlist.length) return null;
  if (!raw.ownedInventory || typeof raw.ownedInventory !== "object" || !Object.keys(raw.ownedInventory).length) return null;
  for (const [rel, rec] of Object.entries(raw.ownedInventory)) {
    if (typeof rel !== "string" || !rel || rel.includes("\\") || rel.includes("..") || path.isAbsolute(rel)) return null;
    if (!rec || typeof rec !== "object" || !rec.hash || !/^[a-f0-9]{64}$/i.test(rec.hash)) return null;
  }
  return raw;
}

function findToolRoot(dir) {
  const nested = path.join(dir, ARCHIVE_ROOT, "tools", "paperclip-ru.mjs");
  if (!fs.existsSync(nested)) return null;
  const top = fs.readdirSync(dir).filter((n) => n !== "." && n !== "..");
  if (top.some((n) => n !== ARCHIVE_ROOT)) return null;
  return path.join(dir, ARCHIVE_ROOT);
}

function requireArtifactManifest(dir) {
  const file = path.join(dir, "artifact-manifest.json");
  if (!fs.existsSync(file)) return null;
  const raw = readJsonSafe(file);
  if (!raw || raw.schema !== "paperclip-ru-artifact-manifest/v1" || !raw.toolVersion) return null;
  if (!raw.payload || typeof raw.payload !== "object" || !Object.keys(raw.payload).length) return null;
  const actual = inventoryTree(dir);
  for (const [rel, rec] of Object.entries(raw.payload)) {
    if (rel === "artifact-manifest.json") continue;
    if (!actual[rel]) throw new Error(`artifact-manifest: отсутствует ${rel}`);
    const expected = rec?.sha256 || rec?.hash;
    if (!/^[a-f0-9]{64}$/.test(expected) || rec.size !== actual[rel].size) throw new Error(`artifact-manifest: invalid hash/size ${rel}`);
    if (actual[rel].hash !== expected) throw new Error(`artifact-manifest: hash mismatch ${rel}`);
  }
  for (const rel of Object.keys(actual)) {
    if (rel === "artifact-manifest.json") continue;
    if (!raw.payload[rel]) throw new Error(`artifact-manifest: unexpected ${rel}`);
  }
  return { file, raw };
}

function validateDetachedReleaseManifest(raw, { archiveName, archivePath, expectedVersion }) {
  if (!raw || raw.schema !== "paperclip-ru-release-manifest/v1") {
    throw new Error("detached release-manifest: неверная schema");
  }
  if (!/^\d+\.\d+\.\d+$/.test(raw.toolVersion) || raw.tag !== `v${raw.toolVersion}` || raw.channel !== "stable") throw new Error("detached release-manifest: invalid stable version/tag/channel");
  const ver = String(expectedVersion || "").replace(/^v/, "");
  if (ver && ver !== "stable" && raw.toolVersion !== ver) {
    throw new Error("detached release-manifest: toolVersion не совпадает с выбранной версией");
  }
  if (ver && ver !== "stable" && raw.tag !== `v${ver}` && raw.tag !== ver) {
    throw new Error("detached release-manifest: tag не совпадает");
  }
  if (raw.repository !== repositorySlug()) throw new Error("detached release-manifest: repository mismatch");
  if (raw.archiveRoot !== ARCHIVE_ROOT) {
    throw new Error("detached release-manifest: archiveRoot");
  }
  const rec = (raw.assets || []).find((a) => a.name === archiveName);
  if (!rec) throw new Error(`detached release-manifest: нет asset ${archiveName}`);
  const st = fs.statSync(archivePath);
  if (Number(rec.size) !== st.size) throw new Error("detached release-manifest: size mismatch");
  if (!rec.sha256 || rec.sha256 !== sha256(fs.readFileSync(archivePath))) {
    throw new Error("detached release-manifest: hash mismatch");
  }
  if (!raw.compatibility?.currentStable) {
    throw new Error("detached release-manifest: нет compatibility.currentStable");
  }
  if (!raw.artifactManifestSha256 || !/^[a-f0-9]{64}$/i.test(raw.artifactManifestSha256)) {
    throw new Error("detached release-manifest: нет artifactManifestSha256");
  }
}

function assertExtractedArtifactHash(dir, detached) {
  const file = path.join(dir, "artifact-manifest.json");
  if (!fs.existsSync(file)) throw new Error("нет artifact-manifest.json после распаковки");
  const actual = sha256(fs.readFileSync(file));
  if (actual !== String(detached.artifactManifestSha256).toLowerCase()) {
    throw new Error("artifactManifestSha256 не совпадает с распакованным artifact-manifest.json");
  }
}

function extractArchive(archive, dest) {
  extractReleaseArchive(archive, dest);
}

function copyTree(from, to, step = (_label, action) => action()) {
  step("stage-mkdir", () => ensureDir(to));
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, ent.name);
    const dest = path.join(to, ent.name);
    if (ent.isSymbolicLink()) throw new Error(`symlink в staged tree: ${ent.name}`);
    if (ent.isDirectory()) copyTree(src, dest, step);
    else {
      step("stage-write", () => fs.copyFileSync(src, dest), ent.name);
    }
  }
}

export function installRuntimeDeps(root) {
  if (!fs.existsSync(path.join(root, "package-lock.json"))) {
    throw new Error("В staged artifact нет package-lock.json — npm ci --omit=dev невозможен");
  }
  hit("npm-ci");
  const isolatedRc = path.join(path.dirname(root), `${path.basename(root)}.npmrc`);
  fs.writeFileSync(isolatedRc, "ignore-scripts=true\nbin-links=false\n");
  const npmEnv = { ...process.env };
  for (const key of Object.keys(npmEnv)) {
    if (/^npm_config_/i.test(key)) delete npmEnv[key];
  }
  npmEnv.npm_config_userconfig = isolatedRc;
  npmEnv.npm_config_ignore_scripts = "true";
  npmEnv.npm_config_bin_links = "false";
  try {
    if (process.platform === "win32") {
      execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm ci --omit=dev"], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 180000,
        env: npmEnv,
      });
    } else {
      execFileSync("npm", ["ci", "--omit=dev"], {
        cwd: root,
        timeout: 180000,
        stdio: ["ignore", "pipe", "pipe"],
        env: npmEnv,
      });
    }
  } finally {
    if (fs.existsSync(isolatedRc)) fs.unlinkSync(isolatedRc);
  }

  if (!fs.existsSync(path.join(root, "node_modules", "acorn", "package.json"))) {
    throw new Error("После npm ci нет runtime dependency acorn");
  }
}

async function download(url, dest) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") throw new Error("Unexpected release download URL");
  const res = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { "User-Agent": "paperclip-ru" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function pickAssetName(version, explicit, platform = process.platform) {
  if (explicit) {
    if (![ `paperclip-ru-${version}.zip`, `paperclip-ru-${version}.tar.gz` ].includes(explicit)) throw new ToolError("Unexpected release asset name", { exitCode: EXIT.USAGE });
    return explicit;
  }
  return platform === "win32" ? `paperclip-ru-${version}.zip` : `paperclip-ru-${version}.tar.gz`;
}

function isReleaseArtifactRuntime() {
  return fs.existsSync(path.join(PROJECT_ROOT, "artifact-manifest.json"));
}

function officialRepo(cliRepo) {
  if (isReleaseArtifactRuntime()) {
    if (cliRepo) {
      throw new ToolError("--repo недоступен в release artifact. Repository берётся только из data/release-config.json.", {
        exitCode: EXIT.USAGE,
      });
    }
    return repositorySlug();
  }
  if (cliRepo && process.env.PAPERCLIP_RU_DEV === "1") return repositorySlug(cliRepo);
  if (cliRepo) {
    throw new ToolError("--repo недоступен в release artifact. Repository берётся только из data/release-config.json.", {
      exitCode: EXIT.USAGE,
    });
  }
  return repositorySlug();
}

async function fetchGithubRelease({ repo, version, assetName }) {
  if (!repo) {
    throw new Error("repository slug не задан в data/release-config.json. Используйте --source-dir либо задайте maljaev-alex/paperclip-ru.");
  }
  const api =
    version === "stable"
      ? `https://api.github.com/repos/${repo}/releases/latest`
      : `https://api.github.com/repos/${repo}/releases/tags/v${String(version).replace(/^v/, "")}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "paperclip-ru", Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub Release недоступен: HTTP ${res.status}`);
  const rel = await res.json();
  const tag = rel.tag_name || "";
  const ver = String(tag).replace(/^v/, "");
  if (rel.draft || rel.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag) || (version !== "stable" && ver !== version)) throw new Error("GitHub release is not the requested stable version");
  const names = [pickAssetName(ver, assetName), pickAssetName(ver), "release-manifest.json", "SHA256SUMS"];
  const assets = {};
  for (const name of names) {
    const found = (rel.assets || []).find((a) => a.name === name);
    if (found) assets[name] = found.browser_download_url;
  }
  return { version: ver, tag, assets };
}

function resolveOfflineSource(sourceDir) {
  const abs = path.resolve(sourceDir);
  if (!fs.existsSync(abs)) throw new Error(`SourceDir не найден: ${abs}`);
  const siblingManifest = path.join(abs, "release-manifest.json");
  const siblingSums = path.join(abs, "SHA256SUMS");
  const archives = fs.readdirSync(abs).filter((n) => n.endsWith(".zip") || n.endsWith(".tar.gz"));
  if (fs.existsSync(siblingManifest) && fs.existsSync(siblingSums) && archives.length) {
    return { kind: "dist", dir: abs, manifest: siblingManifest, sums: siblingSums, archives };
  }
  throw new Error(
    "Offline --source-dir обязан содержать release-manifest.json, SHA256SUMS и архив. Распакованный каталог без checksum receipt отклонён."
  );
}

function parseLastJson(stdout) {
  try { return JSON.parse(String(stdout || "").trim()); } catch { return null; }
}

export function runInstalledCli(installDir, args, { serverDir } = {}) {
  const tool = path.join(installDir, "tools", "paperclip-ru.mjs");
  if (!fs.existsSync(tool)) {
    throw new Error(`После установки нет ${tool}`);
  }
  const argv = [...args];
  if (serverDir && !argv.includes("--server-dir")) argv.push("--server-dir", serverDir);
  const stepName = `cli:${args[0] || "unknown"}${args.includes("--dry-run") ? "-dry-run" : ""}`;
  hit(stepName);
  const res = spawnSync(process.execPath, [tool, ...argv], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      NODE_PATH: path.join(installDir, "node_modules"),
    },
  });
  hit(stepName, { after: true });
  const result = parseLastJson(res.stdout);
  return {
    ok: res.status === 0 && Boolean(result?.ok),
    exitCode: res.status ?? EXIT.ERROR,
    result,
    error: result?.error || (res.status ? (res.stderr || "nonzero child").trim() : null),
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

function runApplyChain({ installDir, serverDir, panelResize = false }) {
  const featureFlags = panelResize ? ["--with-panel-resize"] : [];
  const doctor = runInstalledCli(installDir, ["doctor", "--json"], { serverDir });
  if (!doctor.ok) return { doctor, dryApply: null, apply: null, verify: null };
  const dryApply = runInstalledCli(installDir, ["apply", "--dry-run", "--json", ...featureFlags], { serverDir });
  if (!dryApply.ok) return { doctor, dryApply, apply: null, verify: null };
  const apply = runInstalledCli(installDir, ["apply", "--json", ...featureFlags], { serverDir });
  if (!apply.ok) return { doctor, dryApply, apply, verify: null };
  const verify = runInstalledCli(installDir, ["verify", "--json"], { serverDir });
  return { doctor, dryApply, apply, verify };
}

function chainChild(chain) {
  return {
    doctor: childView(chain.doctor),
    dryApply: childView(chain.dryApply),
    apply: childView(chain.apply),
    verify: childView(chain.verify),
  };
}

function stageAndVerifySource({ opts, releaseVersion, tmp }) {
  let stagedFrom;
  const expectedVersion = releaseVersion === "stable" && opts.sourceDir
    ? readJsonSafe(path.join(opts.sourceDir, "release-manifest.json"))?.toolVersion : releaseVersion;
  if (opts.sourceDir) {
    const src = resolveOfflineSource(opts.sourceDir);
    const sumsText = fs.readFileSync(src.sums, "utf8");
    const preferred = pickAssetName(expectedVersion, opts.asset);
    if (!src.archives.includes(preferred)) {
      throw new Error(`В --source-dir нет выбранного asset ${preferred}`);
    }
    const archive = path.join(src.dir, preferred);
    verifyChecksumForFile(archive, sumsText);
    verifyChecksumForFile(src.manifest, sumsText);
    const detached = readJsonSafe(src.manifest);
    validateDetachedReleaseManifest(detached, {
      archiveName: preferred,
      archivePath: archive,
      expectedVersion,
    });
    if (opts.dryRun) return { dryRunVerified: true, archive };
    const unpacked = path.join(tmp, "unpacked");
    extractArchive(archive, unpacked);
    stagedFrom = findToolRoot(unpacked);
    if (!stagedFrom || !requireArtifactManifest(stagedFrom)) {
      throw new Error("Распакованный asset не содержит документированный корень paperclip-ru/ и artifact-manifest.json");
    }
    assertExtractedArtifactHash(stagedFrom, detached);
  } else {
    const repo = officialRepo(opts.repo);
    return Promise.resolve(null).then(async () => {
      const release = await fetchGithubRelease({
        repo,
        version: releaseVersion,
        assetName: opts.asset,
      });
      const asset = pickAssetName(release.version, opts.asset);
      if (!release.assets[asset] || !release.assets.SHA256SUMS || !release.assets["release-manifest.json"]) {
        throw new Error("В релизе нет выбранного asset, SHA256SUMS или release-manifest.json");
      }
      const dl = path.join(tmp, "dl");
      ensureDir(dl);
      await download(release.assets.SHA256SUMS, path.join(dl, "SHA256SUMS"));
      await download(release.assets["release-manifest.json"], path.join(dl, "release-manifest.json"));
      await download(release.assets[asset], path.join(dl, asset));
      const sumsText = fs.readFileSync(path.join(dl, "SHA256SUMS"), "utf8");
      verifyChecksumForFile(path.join(dl, asset), sumsText);
      verifyChecksumForFile(path.join(dl, "release-manifest.json"), sumsText);
      const detached = readJsonSafe(path.join(dl, "release-manifest.json"));
      validateDetachedReleaseManifest(detached, {
        archiveName: asset,
        archivePath: path.join(dl, asset),
        expectedVersion: release.version,
      });
        const unpacked = path.join(tmp, "unpacked");
      extractArchive(path.join(dl, asset), unpacked);
      const root = findToolRoot(unpacked);
      if (!root || !requireArtifactManifest(root)) {
        throw new Error("Распакованный asset не содержит документированный корень paperclip-ru/");
      }
      assertExtractedArtifactHash(root, detached);
      return root;
    });
  }
  return stagedFrom;
}

function assertSafeOwnedTree(root) {
  const marker = readOwnershipMarker(root);
  if (!marker) throw new Error("ownership marker is missing or invalid");
  const actual = inventoryTree(root);
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(marker.ownedInventory).filter((p) => p !== INSTALL_MARKER).sort())) {
    throw new Error("unexpected or missing owned files");
  }
  for (const [rel, rec] of Object.entries(actual)) {
    if (!marker.ownedAllowlist.includes(rel.split("/")[0]) || rec.hash !== marker.ownedInventory[rel].hash) {
      throw new Error(`owned file changed: ${rel}`);
    }
  }
  const dirs = Object.keys(snapshotInventory(root).dirs).filter(Boolean).sort();
  const expectedDirs = marker.ownedDirectories || [...new Set(Object.keys(actual).flatMap((rel) => {
    const parts = rel.split("/");
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
  }))];
  if (JSON.stringify(dirs) !== JSON.stringify([...expectedDirs].sort())) throw new Error("unexpected owned directories");
  return marker;
}

function inspectPreState(root, serverDir, { replacementRoot } = {}) {
  const status = runInstalledCli(root, ["status", "--json"], { serverDir });
  if (replacementRoot && status.exitCode === EXIT.UNSUPPORTED) {
    const verify = runInstalledCli(root, ['verify', '--json'], { serverDir });
    if (verify.exitCode !== EXIT.UNSUPPORTED) throw new Error('Previous CLI has conflicting compatibility results');
    const replacement = inspectPreState(replacementRoot, serverDir);
    return { state: status.result.stateAfter, status: childView(status), verify: childView(verify), replacementProof: replacement };
  }
  if (!status.ok) throw new ToolError("status did not prove a safe Paperclip state", { exitCode: status.exitCode || EXIT.ERROR, result: status.result });
  const verify = runInstalledCli(root, ["verify", "--json"], { serverDir });
  const state = status.result.stateAfter;
  const stale = state === STATE.APPLIED_STALE && verify.exitCode === EXIT.ERROR
    && verify.result?.stateAfter === state && verify.result?.baselineSafe === true && verify.result?.verification?.integrity === true;
  if (!verify.ok && !stale) throw new ToolError("verify did not prove a safe Paperclip state", { exitCode: verify.exitCode || EXIT.ERROR, result: verify.result });
  return { state, status: childView(status), verify: childView(verify) };
}

function verifyRestoredTool(root, serverDir, before) {
  hit("previous-tool-verify");
  const doctor = runInstalledCli(root, ["doctor", "--json"], { serverDir });
  if (before?.replacementProof && before.status?.exitCode === EXIT.UNSUPPORTED) {
    const status = runInstalledCli(root, ['status', '--json'], { serverDir });
    const verify = runInstalledCli(root, ['verify', '--json'], { serverDir });
    if (![doctor, status, verify].every(step => step.exitCode === EXIT.UNSUPPORTED) || status.result?.stateAfter !== before.state) throw new Error('Previous unsupported state differs after rollback');
    hit('previous-tool-verify', { after: true });
    return before;
  }
  if (!doctor.ok) throw new Error("previous CLI doctor failed");
  const actual = inspectPreState(root, serverDir);
  if (!before || actual.state !== before.state || actual.verify.exitCode !== before.verify.exitCode
    || actual.verify.result.baselineSafe !== before.verify.result.baselineSafe) throw new Error("previous Paperclip state differs");
  hit("previous-tool-verify", { after: true });
  return actual;
}

export function recoverInterruptedLifecycle(installDir, { dryRun = false } = {}) {
  const journal = readLifecycleJournal(installDir);
  return recoverLifecycle(installDir, {
    dryRun,
    verifyPrevious: (preState) => verifyRestoredTool(installDir, journal.serverDir, preState),
  });
}

function lifecyclePreflight(opts, action) {
  const installDir = assertSafeInstallDir(opts.installDir || defaultInstallDir(), { serverDir: opts.serverDir });
  const recovered = recoverInterruptedLifecycle(installDir, { dryRun: Boolean(opts.dryRun) });
  if (recovered.blocked) throwLifecycle("Unfinished lifecycle: recovery is required before this operation.", {
    action, exitCode: EXIT.CONFLICT, extra: { targetDir: installDir, nextAction: NEXT_ACTION.FORCE_MANUAL, details: { reason: recovered.reason } },
  });
  // Check reserved sibling paths and ownership before starting any child mutation.
  for (const suffix of [".prev", ".staging", ".deleting"]) {
    if (fs.existsSync(`${installDir}${suffix}`)) throw new ToolError(`Unowned lifecycle leftover: ${suffix}`, { exitCode: EXIT.CONFLICT });
  }
  if (fs.existsSync(installDir)) assertSafeOwnedTree(installDir);
  else if (action !== "install") throw new ToolError("ownership marker is required", { exitCode: EXIT.CONFLICT });
  return installDir;
}

function lifecycleFailure(err, tx, action, children = {}) {
  let rollbackOk = false;
  let rollbackError = null;
  try {
    if (tx.journal.recovery === "complete") {
      rollbackError = "operation completed; metadata cleanup must be retried";
    } else {
      rollbackLifecycle(tx, (before) => verifyRestoredTool(tx.journal.installDir, tx.journal.serverDir, before));
      rollbackOk = true;
    }
  } catch (restoreErr) { rollbackError = restoreErr.message; }
  const before = tx.journal.preState;
  throwLifecycle(err.message, {
    action,
    exitCode: err.exitCode || (["EPERM", "EACCES", "EROFS"].includes(err.code) ? EXIT.PERMISSION : EXIT.ERROR),
    extra: {
      stateBefore: before?.state ?? null,
      stateAfter: rollbackOk ? before?.state ?? null : STATE.CONFLICT,
      changed: !rollbackOk,
      targetDir: tx.journal.installDir,
      baselineSafe: rollbackOk ? before?.verify?.result?.baselineSafe ?? null : false,
      compatible: before?.verify?.result?.compatible ?? null,
      nextAction: rollbackOk ? NEXT_ACTION.REPORT : NEXT_ACTION.FORCE_MANUAL,
      child: children,
      details: { rollbackOk, rollbackError, journal: rollbackOk ? null : tx.file },
    },
  });
}

function selectedOfflineVersion(opts, selected) {
  return selected === "stable" && opts.sourceDir
    ? assertReleaseVersion(readJsonSafe(path.join(opts.sourceDir, "release-manifest.json"))?.toolVersion) : selected;
}

function validateStagedVersion(root) {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  const artifact = readJsonSafe(path.join(root, "artifact-manifest.json"));
  const lock = readJsonSafe(path.join(root, 'package-lock.json'));
  const compatibility = readJsonSafe(path.join(root, 'data/compatibility.json'));
  const cli = runInstalledCli(root, ["--version", "--json"]);
  if (pkg?.name !== TOOL_NAME || !cli.ok || cli.result.toolVersion !== pkg.version || artifact?.toolVersion !== pkg.version
    || lock?.version !== pkg.version || lock?.packages?.['']?.version !== pkg.version || compatibility?.toolVersion !== pkg.version) {
    throw new Error("package, CLI and artifact versions differ");
  }
  return pkg.version;
}

export async function runInstall(opts) {
  const action = opts.action || "install";
  if (opts.skipApply) throw new ToolError("--skip-apply is not supported", { exitCode: EXIT.USAGE });
  const selected = assertReleaseVersion(opts.releaseVersion);
  const installDir = lifecyclePreflight(opts, action);
  if (opts.dryRun) {
    if (opts.sourceDir) {
      const src = resolveOfflineSource(opts.sourceDir);
      const version = selectedOfflineVersion(opts, selected);
      const name = pickAssetName(version, opts.asset);
      const archive = path.join(src.dir, name);
      const sums = fs.readFileSync(src.sums, "utf8");
      verifyChecksumForFile(archive, sums);
      verifyChecksumForFile(src.manifest, sums);
      validateDetachedReleaseManifest(readJsonSafe(src.manifest), { archiveName: name, archivePath: archive, expectedVersion: version });
    } else officialRepo(opts.repo);
    return { ...emptyLifecycle(action, { targetDir: installDir, nextAction: NEXT_ACTION.NONE }), ok: true, message: "dry-run: no files changed and no network requests made" };
  }
  const tmp = createTempDir("paperclip-ru-source-");
  let tx = null;
  let children = {};
  try {
    const source = await stageAndVerifySource({ opts, releaseVersion: selected, tmp });
    // Dependencies are installed only after the verified archive has been extracted.
    installRuntimeDeps(source);
    const version = validateStagedVersion(source);
    const doctor = runInstalledCli(source, ["doctor", "--json"], { serverDir: opts.serverDir });
    if (!doctor.ok) throw new ToolError("staged CLI doctor failed", { exitCode: doctor.exitCode || EXIT.ERROR, result: doctor.result });
    const serverDir = findServerPackage({ serverDir: opts.serverDir }).dir;
    assertSafeInstallDir(installDir, { serverDir });
    const preRoot = fs.existsSync(installDir) ? installDir : source;
    const preState = inspectPreState(preRoot, serverDir, { replacementRoot: preRoot !== source ? source : null });
    const panelResize = (preState.replacementProof || preState).status.result?.details?.manifest?.features?.includes("panel-resize") === true;
    const installedVersion = fs.existsSync(installDir) ? readOwnershipMarker(installDir).toolVersion : null;
    const preflight = runInstalledCli(source, ["apply", "--dry-run", "--json", ...(panelResize ? ["--with-panel-resize"] : [])], { serverDir });
    if (!preflight.ok) throw new ToolError("staged CLI dry-run failed", { exitCode: preflight.exitCode || EXIT.ERROR, result: preflight.result });
    writeOwnershipMarker(source, { toolVersion: version });
    const plannedUiHashes = Object.fromEntries((preflight.result.files || []).map((file) => [file.file, file.toHash]));
    if (preflight.result.details?.overlayHash) plannedUiHashes['assets/paperclip-ru-overlay.js'] = preflight.result.details.overlayHash;
    tx = createLifecycleTransaction({ action, installDir, serverDir, preState, sourceInventory: snapshotInventory(source), plannedUiHashes });
    prepareLifecycleSnapshots(tx);
    for (const parent of [...tx.journal.createdParents].reverse()) tx.step('mkdir-install-parent', () => fs.mkdirSync(parent));
    const stageRoot = `${installDir}.staging`;
    tx.step("mkdir-install-staging", () => fs.mkdirSync(stageRoot));
    copyTree(source, stageRoot, tx.step);
    tx.step("write-ownership-marker", () => assertSafeOwnedTree(stageRoot));
    tx.journal.activatedInventory = snapshotInventory(stageRoot);
    if (fs.existsSync(installDir)) tx.step("rename-install-to-prev", () => fs.renameSync(installDir, `${installDir}.prev`));
    tx.step("rename-stage-to-install", () => fs.renameSync(stageRoot, installDir));
    const chain = tx.step("installed-cli-chain", () => runApplyChain({ installDir, serverDir, panelResize }));
    children = chainChild(chain);
    const failed = [chain.doctor, chain.dryApply, chain.apply, chain.verify].find((s) => !s?.ok);
    if (failed || !chain.verify?.ok || chain.verify.result.stateAfter !== STATE.APPLIED_CURRENT) {
      throw new ToolError(failed?.error || "installed CLI chain failed", { exitCode: failed?.exitCode || EXIT.ERROR });
    }
    assertSafeOwnedTree(installDir);
    if (installedVersion) {
      assertSafeOwnedTree(`${installDir}.prev`);
      tx.step("remove-prev", () => removeTree(`${installDir}.prev`, tx.step, "remove-prev-file"));
    }
    const result = {
      ...emptyLifecycle(action), ok: true, changed: true,
      stateBefore: preState.state, stateAfter: STATE.APPLIED_CURRENT,
      paperclipVersion: chain.verify.result.paperclipVersion, toolVersion: version,
      installedVersion, selectedVersion: version, warnings: installedVersion === version ? ["Установленная версия совпадает с выбранной; файлы перепроверены."] : [], compatible: chain.verify.result.compatible,
      targetDir: installDir, baselineSafe: chain.verify.result.baselineSafe,
      verification: chain.verify.result.verification, child: children, nextAction: NEXT_ACTION.NONE,
      message: `Установлено в ${installDir}. Обновите страницу Paperclip (Ctrl+F5).`,
    };
    const committed = commitLifecycle(tx);
    if (committed.warning) result.warnings.push(committed.warning);
    return result;
  } catch (err) {
    if (tx) lifecycleFailure(err, tx, action, children);
    if (err instanceof ToolError) throw err;
    throwLifecycle(err.message, { action, extra: { targetDir: installDir } });
  } finally { removeTree(tmp); }
}

export async function runUpdate(opts) {
  return runInstall({ ...opts, action: "update" });
}

export async function runUninstall(opts) {
  const action = "uninstall";
  const installDir = lifecyclePreflight(opts, action);
  const serverDir = findServerPackage({ serverDir: opts.serverDir }).dir;
  assertSafeInstallDir(installDir, { serverDir });
  const marker = assertSafeOwnedTree(installDir);
  const status = runInstalledCli(installDir, ["status", "--json"], { serverDir });
  const verify = runInstalledCli(installDir, ["verify", "--json"], { serverDir });
  const children = { status: childView(status), verify: childView(verify) };
  const failed = [status, verify].find((s) => !s.ok);
  if (failed) throwLifecycle("Uninstall blocked: status/verify failed. No files were removed.", {
    action, exitCode: failed.exitCode || EXIT.ERROR,
    extra: { targetDir: installDir, baselineSafe: failed.result?.baselineSafe ?? null, child: children, nextAction: NEXT_ACTION.FORCE_MANUAL },
  });
  if (opts.dryRun) return { ...emptyLifecycle(action, { targetDir: installDir, nextAction: NEXT_ACTION.NONE, child: children }), ok: true, message: "dry-run: no files changed" };
  const preState = { state: status.result.stateAfter, status: childView(status), verify: childView(verify) };
  const manifest = readJsonSafe(path.join(serverDir, 'ui-dist', '.paperclip-ru', 'manifest.json'));
  const plannedUiHashes = Object.fromEntries(Object.entries(manifest?.files || {}).map(([rel, rec]) => [rel, rec.baselineHash]));
  const tx = createLifecycleTransaction({ action, installDir, serverDir, preState, plannedUiHashes });
  try {
    prepareLifecycleSnapshots(tx);
    let reverted = verify;
    if (preState.state !== STATE.INSTALLED_NOT_APPLIED) {
      reverted = tx.step("uninstall-revert", () => runInstalledCli(installDir, ["revert", "--json"], { serverDir }));
      children.revert = childView(reverted);
      if (!reverted.ok || reverted.result?.verification?.byteIdentical !== true || reverted.result.stateAfter !== STATE.INSTALLED_NOT_APPLIED) {
        throw new ToolError("uninstall: byte-identical revert was not proved", { exitCode: reverted.exitCode || EXIT.CONFLICT });
      }
    }
    const after = tx.step("uninstall-final-verify", () => runInstalledCli(installDir, ["verify", "--json"], { serverDir }));
    children.finalVerify = childView(after);
    if (!after.ok || after.result.stateAfter !== STATE.INSTALLED_NOT_APPLIED) throw new ToolError("uninstall: final verify failed", { exitCode: after.exitCode || EXIT.CONFLICT });
    assertSafeOwnedTree(installDir);
    tx.step("uninstall-remove", () => fs.renameSync(installDir, `${installDir}.deleting`));
    removeTree(`${installDir}.deleting`, tx.step, "uninstall-owned-remove");
    if (fs.existsSync(installDir) || fs.existsSync(`${installDir}.deleting`)) throw new Error("uninstall: owned root remains");
    const committed = commitLifecycle(tx);
    return {
      ...emptyLifecycle(action), ok: true, changed: true,
      stateBefore: preState.state, stateAfter: STATE.NOT_INSTALLED,
      paperclipVersion: verify.result.paperclipVersion, toolVersion: marker.toolVersion,
      compatible: verify.result.compatible, baselineSafe: after.result.baselineSafe,
      targetDir: installDir, verification: { ...after.result.verification, byteIdentical: true },
      nextAction: NEXT_ACTION.NONE, child: children,
      warnings: committed.warning ? [committed.warning] : [],
      message: "Русификатор удалён. Paperclip сохранён в исходном состоянии.",
    };
  } catch (err) { lifecycleFailure(err, tx, action, children); }
}
