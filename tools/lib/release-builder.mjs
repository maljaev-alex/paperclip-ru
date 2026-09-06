import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PROJECT_ROOT } from "./dictionary.mjs";
import { ARCHIVE_ROOT, TOOL_VERSION } from "./constants.mjs";
import { ensureDir, sha256 } from "./fs-atomic.mjs";
import { writeTarGzFromDirectory, writeZipFromDirectory } from "./zip-write.mjs";
import { loadCompatibility } from "./compatibility.mjs";
import { loadReleaseConfig } from "./release-config.mjs";
import { assertCleanScan } from "./secret-scan.mjs";
import { extractReleaseArchive } from "./archive-read.mjs";
import { acceptSvgTree } from "./svg-accept.mjs";

const BLOCKED = [
  /^(?:work|dist|node_modules|test-results|coverage)(?:\/|$)/,
  /^docs\/audits\//,
  /^(?:docs\/)?(?:COMPREHENSIVE-REVIEW|INDEPENDENT-REVIEW|PANEL-RESIZE-FIX|PUBLIC-RELEASE-SPEC|RELEASE-CANDIDATE-REPORT|RELEASE-REMEDIATION)/i,
  /^docs\/(?:AGENT-HANDOFF|CHAT-EXPORT|HANDOFF-AFTER-R7)\.md$/i,
  /^locales\/parts\//,
  /^\.git(?:\/|$)/,
  /^\.paperclip-ru(?:\/|$)/,
  /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i,
  /\.(?:tmp|temp|bak|old|orig|rej|log|zip|tgz|tar\.gz)$/i,
];

const REQUIRED_CONTRIBUTOR_FILES = [
  "CONTRIBUTING.md",
  "data/lint-warning-baseline.json",
  "docs/ARCHITECTURE.md",
  "docs/TESTING.md",
  "docs/TRANSLATION-GUIDE.md",
  "test/unit/dictionary.test.mjs",
  "test/integration/final-byte.test.mjs",
  "test/official/routes.test.mjs",
  "tools/lint-dictionary.mjs",
  "tools/pack-release.mjs",
  "tools/prepare-translation.mjs",
];

function gitStatusPorcelain() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean);
  } catch {
    throw new Error('Release build requires a Git checkout');
  }
}

function gitTrackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
      .map((file) => file.replace(/\\/g, "/"));
  } catch {
    throw new Error("Release build requires a Git checkout");
  }
}

function assertCleanWorktree({ skip = false } = {}) {
  if (skip) return;
  const dirty = gitStatusPorcelain().filter((line) => {
    const file = line.replace(/^\s*[A-Z?]{1,2}\s+/, "").replace(/"/g, "");
    return file !== "dist" && !file.startsWith("dist/");
  });
  if (dirty.length) {
    throw new Error(`release build отказан: dirty tree (${dirty.length} путей). Commit the reviewed source before building a release.`);
  }
}

function payloadInventory(root) {
  const files = {};
  const walk = (dir, relBase) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, rel);
      else {
        const st = fs.statSync(p);
        files[rel] = { sha256: sha256(fs.readFileSync(p)), size: st.size };
      }
    }
  };
  walk(root, "");
  return files;
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function buildTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(String(epoch))) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  try {
    const iso = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (iso) return iso;
  } catch {
    /* fall through */
  }
  return new Date().toISOString();
}

function copyFile(from, to) {
  if (!fs.lstatSync(from).isFile()) throw new Error('Release input is not a regular file');
  ensureDir(path.dirname(to));
  const bytes = fs.readFileSync(from);
  const text = /\.(mjs|js|json|md|ps1|sh|yml|yaml|svg|txt|html|css)$/.test(from) || ['LICENSE', '.npmrc', '.gitignore', '.gitattributes'].includes(path.basename(from));
  fs.writeFileSync(to, text ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes);
}

export function publishableAssetNames(version = TOOL_VERSION) {
  return [
    `paperclip-ru-${version}.zip`,
    `paperclip-ru-${version}.tar.gz`,
    "release-manifest.json",
    "SHA256SUMS",
  ];
}

function assertPublishDirectory(dir, version, { complete = false } = {}) {
  if (!fs.existsSync(dir)) return;
  const allowed = new Set(publishableAssetNames(version));
  const actual = fs.readdirSync(dir, { withFileTypes: true });
  const unexpected = actual
    .filter((entry) => !entry.isFile() || !allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (unexpected.length) {
    throw new Error(`В каталоге release есть лишние или устаревшие файлы: ${unexpected.join(", ")}`);
  }
  if (complete) {
    const present = new Set(actual.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const missing = [...allowed].filter((name) => !present.has(name));
    if (missing.length) throw new Error(`Неполный состав release: ${missing.join(", ")}`);
  }
}

export function createTempDir(prefix = "paperclip-ru-release-") {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tmp, prefix));
  const real = fs.realpathSync(dir);
  const rel = path.relative(tmp, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error("temp directory escaped os.tmpdir()");
  }
  return real;
}

function findToolRoot(extracted) {
  const direct = path.join(extracted, "tools", "paperclip-ru.mjs");
  const nested = path.join(extracted, ARCHIVE_ROOT, "tools", "paperclip-ru.mjs");
  if (fs.existsSync(direct)) return extracted;
  if (fs.existsSync(nested)) return path.join(extracted, ARCHIVE_ROOT);
  return null;
}

function assetChecksumLine(sumsText, filename) {
  const lines = String(sumsText).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(\S+)$/);
    if (m && m[2] === filename) return m[1].toLowerCase();
  }
  return null;
}

export function verifyChecksumForFile(filePath, sumsText) {
  const name = path.basename(filePath);
  const expected = assetChecksumLine(sumsText, name);
  if (!expected) {
    throw new Error(`В SHA256SUMS нет записи для ${name}`);
  }
  const actual = sha256(fs.readFileSync(filePath));
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${name}`);
  }
  return actual;
}

function normalizeShellScripts(root) {
  const scripts = path.join(root, "scripts");
  if (!fs.existsSync(scripts)) return;
  for (const name of fs.readdirSync(scripts)) {
    if (!name.endsWith(".sh")) continue;
    const file = path.join(scripts, name);
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    fs.writeFileSync(file, text);
    try {
      fs.chmodSync(file, 0o755);
    } catch {
      /* Windows may ignore executable bit */
    }
  }
}

export function stageReleaseTree({ dest }) {
  const root = path.join(dest, ARCHIVE_ROOT);
  const realProjectRoot = fs.realpathSync(PROJECT_ROOT);
  ensureDir(root);
  const files = gitTrackedFiles();
  const blocked = files.filter((file) => BLOCKED.some((re) => re.test(file)));
  if (blocked.length) {
    throw new Error(`В Git отслеживаются запрещённые release-пути: ${blocked.join(", ")}`);
  }
  const missing = REQUIRED_CONTRIBUTOR_FILES.filter((file) => !files.includes(file));
  if (missing.length) {
    throw new Error(`В release не хватает файлов для разработки: ${missing.join(", ")}`);
  }
  for (const file of files) {
    const src = path.join(PROJECT_ROOT, ...file.split("/"));
    const relative = path.relative(PROJECT_ROOT, src);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Release input escaped repository: ${file}`);
    }
    const stat = fs.lstatSync(src);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Release input is not a regular file: ${file}`);
    }
    const realSource = fs.realpathSync(src);
    const realRelative = path.relative(realProjectRoot, realSource);
    if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error(`Release input resolved outside repository: ${file}`);
    }
    copyFile(src, path.join(root, ...file.split("/")));
  }
  return root;
}

/** @typedef {{ outDir?: string, dryRun?: boolean, testBuild?: boolean }} ReleaseBuildOptions */

/**
 * @param {ReleaseBuildOptions} [options]
 */
export function buildRelease(options = /** @type {ReleaseBuildOptions} */ ({})) {
  const { outDir, dryRun = false, testBuild = false } = options;
  const config = loadReleaseConfig();
  const compat = loadCompatibility();
  const version = TOOL_VERSION;
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package-lock.json"), "utf8"));
  if (pkg.version !== version || lock.version !== version || lock.packages?.[""]?.version !== version || compat.toolVersion !== version) throw new Error("Release version differs between package, lockfile, CLI and compatibility metadata");
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error("Release tag differs from the payload version");
  if (testBuild && !outDir) throw new Error('A test build requires a separate output directory');
  if (testBuild) {
    const relative = path.relative(PROJECT_ROOT, path.resolve(outDir));
    if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Test artifacts must be outside the repository');
  }
  assertCleanWorktree({ skip: testBuild });
  const stagingHome = createTempDir();
  const createdOut = Boolean(outDir);
  const dist = dryRun && !outDir
    ? path.join(stagingHome, "dist")
    : (outDir ? path.resolve(outDir) : path.join(PROJECT_ROOT, "dist"));
  try {
    const tree = stageReleaseTree({ dest: stagingHome });
    normalizeShellScripts(tree);
    assertCleanScan(tree);
    acceptSvgTree(path.join(PROJECT_ROOT, "docs", "images"));
    if (!fs.existsSync(path.join(tree, "package-lock.json"))) {
      throw new Error("В артефакте нет package-lock.json — npm ci --omit=dev невозможен");
    }
    if (!fs.existsSync(path.join(tree, "tools", "paperclip-ru.mjs"))) {
      throw new Error("Не найден tools/paperclip-ru.mjs в корне архива");
    }

    ensureDir(dist);
    const zipName = `paperclip-ru-${version}.zip`;
    const tarName = `paperclip-ru-${version}.tar.gz`;
    const zipPath = path.join(dist, zipName);
    const tarPath = path.join(dist, tarName);

    assertPublishDirectory(dist, version);

    const artifactManifest = {
      schema: "paperclip-ru-artifact-manifest/v1",
      testBuild,
      toolVersion: version,
      gitCommit: gitCommit(),
      channel: config.defaultChannel || "stable",
      tag: `v${version}`,
      repository: config.repository,
      node: config.node,
      powershell: config.powershell,
      archiveRoot: ARCHIVE_ROOT,
      compatibility: {
        currentStable: compat.currentStable,
        policy: compat.policy,
        releases: compat.releases,
      },
      contents: {
        profile: "contributor",
        trackedSnapshot: true,
        includes: ["runtime", "development-tools", "tests", "fixtures", "documentation", "ci"],
        excludes: ["dependencies", "generated-work", "review-artifacts", "previous-builds"],
      },
      payload: payloadInventory(tree),
      builtAt: buildTimestamp(),
    };
    const manifestFile = path.join(tree, "artifact-manifest.json");
    fs.writeFileSync(manifestFile, `${JSON.stringify(artifactManifest, null, 2)}\n`);

    writeZipFromDirectory(tree, zipPath, { rootName: ARCHIVE_ROOT });
    writeTarGzFromDirectory(tree, tarPath, { rootName: ARCHIVE_ROOT });

    const assets = [
      { name: zipName, role: "archive", size: fs.statSync(zipPath).size, sha256: sha256(fs.readFileSync(zipPath)) },
      { name: tarName, role: "archive", size: fs.statSync(tarPath).size, sha256: sha256(fs.readFileSync(tarPath)) },
    ];
    const manifest = {
      ...artifactManifest,
      schema: "paperclip-ru-release-manifest/v1",
      artifactManifest: "artifact-manifest.json",
      artifactManifestSha256: sha256(fs.readFileSync(path.join(tree, "artifact-manifest.json"))),
      assets,
    };
    const manifestName = "release-manifest.json";
    const manifestPath = path.join(dist, manifestName);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const sumsPath = path.join(dist, "SHA256SUMS");
    const sumsLines = [
      ...assets.map((asset) => `${asset.sha256}  ${asset.name}`),
      `${sha256(fs.readFileSync(manifestPath))}  ${manifestName}`,
    ];
    fs.writeFileSync(sumsPath, `${sumsLines.join("\n")}\n`);

    assertArchiveLayout(zipPath, tarPath);
    assertPublishDirectory(dist, version, { complete: true });

    return {
      dist,
      version,
      zipPath,
      tarPath,
      manifestPath,
      sumsPath,
      manifest,
      dryRun,
      createdOut,
    };
  } finally {
    fs.rmSync(stagingHome, { recursive: true, force: true });
  }
}

export function assertArchiveLayout(zipPath, tarPath) {
  const tmp = createTempDir("paperclip-ru-unpack-");
  try {
    for (const archive of [zipPath, tarPath]) {
      const dest = path.join(tmp, path.basename(archive));
      ensureDir(dest);
      extractReleaseArchive(archive, dest);
      const root = findToolRoot(dest);
      if (!root) {
        throw new Error(`${path.basename(archive)}: нет ${ARCHIVE_ROOT}/tools/paperclip-ru.mjs`);
      }
      const expected = path.join(dest, ARCHIVE_ROOT, "tools", "paperclip-ru.mjs");
      if (path.resolve(path.join(root, "tools", "paperclip-ru.mjs")) !== path.resolve(expected)) {
        throw new Error(`${path.basename(archive)}: неожиданный корень архива`);
      }
      if (!fs.existsSync(path.join(root, "package-lock.json"))) {
        throw new Error(`${path.basename(archive)}: нет package-lock.json`);
      }
      if (!fs.existsSync(path.join(root, "artifact-manifest.json"))) {
        throw new Error(`${path.basename(archive)}: нет artifact-manifest.json`);
      }
      if (fs.existsSync(path.join(root, "release-manifest.json"))) {
        throw new Error(`${path.basename(archive)}: detached release-manifest.json не должен быть внутри архива`);
      }
      const scriptsDir = path.join(root, "scripts");
      if (fs.existsSync(scriptsDir)) {
        for (const name of fs.readdirSync(scriptsDir)) {
          if (!name.endsWith(".sh")) continue;
          const mode = fs.statSync(path.join(scriptsDir, name)).mode & 0o777;
          if (process.platform !== "win32" && (mode & 0o111) === 0) {
            throw new Error(`${path.basename(archive)}: ${name} не исполняемый (mode ${mode.toString(8)})`);
          }
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function listNpmPackFiles() {
  /** @type {import("node:child_process").ExecFileSyncOptionsWithStringEncoding} */
  const opts = {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
  const out =
    process.platform === "win32"
      ? execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", "pack", "--dry-run", "--json"], opts)
      : execFileSync("npm", ["pack", "--dry-run", "--json"], opts);
  const parsed = JSON.parse(out);
  const pack = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]];
  const files = pack?.files?.map((f) => f.path) || [];
  const blocked = files.filter((f) => BLOCKED.some((re) => re.test(String(f).replace(/\\/g, "/"))));
  if (blocked.length) {
    throw new Error(`В npm pack попали запрещённые пути: ${blocked.join(", ")}`);
  }
  return files;
}
