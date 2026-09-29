import test from "node:test";
import assert from "node:assert/strict";
import { parseArgv } from "../../tools/lib/args.mjs";
import { EXIT, TOOL_VERSION } from "../../tools/lib/constants.mjs";
import { ToolError } from "../../tools/lib/fs-atomic.mjs";
import { candidateRoots } from "../../tools/lib/paths.mjs";
import { buildManifest, normalizeManifest } from "../../tools/lib/manifest.mjs";
import { patchIndexHtml, patchInstructionDirtyCompare, patchSkillOverviewNavigation, INDEX_MARKER, OVERLAY_FILE } from "../../tools/lib/overlay.mjs";
import { assertInside, sha256 } from "../../tools/lib/fs-atomic.mjs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

test("неизвестная команда — usage error", () => {
  assert.throws(() => parseArgv(["nope"]), (err) => err instanceof ToolError && err.exitCode === EXIT.USAGE);
});

test("неизвестный флаг — usage error", () => {
  assert.throws(() => parseArgv(["status", "--wat"]), (err) => err.exitCode === EXIT.USAGE);
});

test("known flags are rejected outside their command even at default values", () => {
  for (const argv of [["doctor", "--live"], ["apply", "--live"], ["status", "--release-version", "stable"], ["--version", "--dry-run"]]) {
    assert.throws(() => parseArgv(argv), (err) => err.exitCode === EXIT.USAGE, argv.join(" "));
  }
  assert.equal(parseArgv(["extract", "--live"]).flags.live, true);
  assert.equal(parseArgv(["install", "--release-version", "stable"]).flags.releaseVersion, "stable");
  assert.equal(parseArgv(["--version", "--json"]).command, "version");
});

test("--server-dir приоритетнее env в candidateRoots порядке", () => {
  const roots = candidateRoots({
    env: { PAPERCLIP_SERVER_DIR: "C:\\from-env", APPDATA: "C:\\ap", HOME: "C:\\home" },
    platform: "win32",
    execSync: () => "C:\\npm-root",
  });
  assert.equal(roots[0], "C:\\from-env");
});

test("path discovery linux/macos кандидаты", () => {
  const linux = candidateRoots({
    env: { HOME: "/home/user", PREFIX: "/usr" },
    platform: "linux",
    execSync: () => "/usr/lib/node_modules",
  });
  assert.ok(linux.some((p) => p.includes("/usr/lib/node_modules")));
  const mac = candidateRoots({
    env: { HOME: "/Users/me" },
    platform: "darwin",
    execSync: () => "/usr/local/lib/node_modules",
  });
  assert.ok(mac.some((p) => p.includes(".npm-global")));
});

test("строгий manifest: empty files / missing hash / dotdot / v2", () => {
  const hash = "a".repeat(64);
  const hash2 = "b".repeat(64);
  const base = {
    schema: "paperclip-ru-manifest/v3",
    tool: "paperclip-ru",
    toolVersion: "1.0.0",
    serverVersion: "2026.831.1",
    paperclipVersion: "2026.831.1",
    dictionaryHash: hash,
    features: ["translation"],
    overlayStamp: hash2.slice(0, 10),
    overlayHash: hash2,
    files: { "index.html": { baselineHash: hash, patchedHash: hash2 } },
    ownedFiles: ["index.html"],
    inspectedTargets: ["index.html"],
    ownedPaths: ["assets/paperclip-ru-overlay.js", ".paperclip-ru/manifest.json", ".paperclip-ru/baseline/index.html"],
    uiDistFingerprint: hash,
  };
  assert.ok(normalizeManifest(base, { strict: true }));
  assert.equal(normalizeManifest({ ...base, overlayStamp: "stamp" }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, files: {} }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, overlayHash: null }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, toolVersion: "" }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, ownedFiles: ["index.html", "assets/app.js"] }, { strict: true }), null);
  assert.equal(normalizeManifest({
    ...base,
    files: { "../../outside": { baselineHash: hash, patchedHash: hash2 } },
    ownedFiles: ["../../outside"],
    inspectedTargets: ["../../outside"],
  }, { strict: true }), null);
  assert.equal(normalizeManifest({
    ...base,
    files: { "C:/abs.js": { baselineHash: hash, patchedHash: hash2 } },
    ownedFiles: ["C:/abs.js"],
    inspectedTargets: ["C:/abs.js"],
  }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, schema: "paperclip-ru-manifest/v2" }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, ownedPaths: undefined }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, uiDistFingerprint: undefined }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, inspectedTargets: ["index.html", "index.html"] }, { strict: true }), null);
  assert.equal(normalizeManifest({ ...base, serverVersion: "x", paperclipVersion: "y" }, { strict: true }), null);
  assert.ok(normalizeManifest({
    ...base,
    ownedPaths: ["assets/paperclip-ru-overlay.js", ".paperclip-ru/manifest.json", ".paperclip-ru/baseline/index.html"],
    uiDistFingerprint: hash,
  }, { strict: true }));
});

test("невалидный --release-version", () => {
  assert.throws(() => parseArgv(["install", "--release-version", "main"]), (err) => err.exitCode === EXIT.USAGE);
});

test("manifest schema v3", () => {
  const hash = "a".repeat(64);
  const hash2 = "b".repeat(64);
  const m = buildManifest({
    serverVersion: "2026.831.1",
    dictionaryHash: hash,
    dictionaryEntries: 1,
    files: { "index.html": { baselineHash: hash, patchedHash: hash2 } },
    features: ["translation"],
    overlayStamp: hash2.slice(0, 10),
    overlayHash: hash2,
  });
  assert.equal(m.schema, "paperclip-ru-manifest/v3");
  assert.equal(m.toolVersion, TOOL_VERSION);
  assert.ok(m.appliedAt);
  const n = normalizeManifest(m);
  assert.equal(n.files["index.html"].baselineHash, hash);
  assert.equal(n.overlayHash, hash2);
});

test("patchIndexHtml идемпотентен по маркеру", () => {
  const html = `<html lang="en">\n<head>\n    <script type="module" src="/assets/app.js"></script>\n</head></html>`;
  const once = patchIndexHtml(html, "aaa");
  assert.match(once, new RegExp(INDEX_MARKER));
  assert.match(once, /lang="ru"/);
  const twice = patchIndexHtml(once, "bbb");
  assert.equal((twice.match(/PAPERCLIP_RU_OVERLAY_START/g) || []).length, 1);
  assert.match(twice, /\?v=bbb/);
});

test("instruction dirty compare: точное совпадение", () => {
  const code = `foo(bar??"AGENTS.md"),isDirty=draft!==null&&draft!==saved;onDirtyChange(isDirty)`;
  const { patched, code: out } = patchInstructionDirtyCompare(code);
  assert.equal(patched, true);
  assert.match(out, /window\.__paperclipRu\.instructionsEqual\(draft,saved\)/);
  assert.equal(patchInstructionDirtyCompare(out).code, out);
});

test("instruction dirty compare: неизвестная сигнатура", () => {
  const { patched } = patchInstructionDirtyCompare(`const x = "AGENTS.md";`);
  assert.equal(patched, false);
});

test("skill overview navigation: после файла уходит с /files/", () => {
  const code = `nn=(0,h.useMemo)(()=>QVn(e),[e]),jt=nn.filePath;Je=nn.hasExplicitFilePath||jt!=="SKILL.md"?"files":"overview";function Ct(Ie){i(he=>{const Ge=new URLSearchParams(he);return Ie==="overview"?Ge.delete("tab"):Ge.set("tab",Ie),Ge})}function qs(Ie,he){return wE(Ie,he)}onSelectPath:Ie=>{Ct("files"),t(qs(_t,Ie))}`;
  const { patched, code: out } = patchSkillOverviewNavigation(code);
  assert.equal(patched, true);
  assert.match(out, /Ie==="overview"&&nn\.hasExplicitFilePath&&_t&&t\(qs\(_t\)\)/);
  assert.equal(patchSkillOverviewNavigation(out).patched, true);
  assert.equal(patchSkillOverviewNavigation(out).code, out);
});

test("skill overview navigation: неизвестная сигнатура", () => {
  const { patched } = patchSkillOverviewNavigation(`function Ct(Ie){return Ie}`);
  assert.equal(patched, false);
});

test("assertInside блокирует выход по .. и symlink-цель вне корня", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-ru-root-"));
  fs.mkdirSync(path.join(root, "ui"));
  assert.throws(() => assertInside(root, path.join(root, "..", "outside.txt")));
});

test("sha256 стабилен", () => {
  assert.equal(sha256("a"), sha256("a"));
  assert.notEqual(sha256("a"), sha256("b"));
});

test("owner slug и private package", async () => {
  const { repositorySlug } = await import("../../tools/lib/release-config.mjs");
  const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  assert.equal(repositorySlug(), "maljaev-alex/paperclip-ru");
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.repository.url, /maljaev-alex\/paperclip-ru/);
});

test("invalid manifest важнее unsupported", async () => {
  const { classifyState } = await import("../../tools/lib/classify.mjs");
  const { STATE } = await import("../../tools/lib/constants.mjs");
  const classified = classifyState({
    server: { version: "0.0.0-unknown", uiDist: os.tmpdir() },
    manifestInspection: { status: "invalid", manifest: null, reason: "schema" },
    targets: ["index.html"],
    live: new Map([["index.html", "<html></html>"]]),
    dict: { fingerprint: "a".repeat(64) },
    panelResize: false,
    compat: { compatible: false, support: "none", reason: "unknown" },
    work: { root: path.join(os.tmpdir(), "missing-work"), manifest: path.join(os.tmpdir(), "missing-manifest.json") },
  });
  assert.equal(classified.state, STATE.CONFLICT);
  assert.equal(classified.manifestStatus, "invalid");
});

test("SVG UTF-8/XML acceptance", async (t) => {
  const { acceptSvgFile, acceptSvgTree, assertWellFormedXml } = await import("../../tools/lib/svg-accept.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-ru-svg-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested);
  const unicode = path.join(root, "unicode.svg");
  fs.writeFileSync(unicode, '<svg xmlns="http://www.w3.org/2000/svg"><text>Русский интерфейс</text></svg>', "utf8");
  fs.writeFileSync(path.join(nested, "shape.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', "utf8");
  const files = acceptSvgTree(root);
  assert.deepEqual(files.map((file) => path.basename(file)).sort(), ["shape.svg", "unicode.svg"]);
  assert.match(acceptSvgFile(unicode), /Русский интерфейс/);

  const invalidUtf8 = path.join(root, "invalid.svg");
  fs.writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
  assert.throws(() => acceptSvgFile(invalidUtf8));
  const validRoot = '<svg xmlns="http://www.w3.org/2000/svg">';
  for (const malformed of [validRoot + '</svg>' + validRoot + '</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" id="a" id="b"></svg>',
    validRoot + '&nbsp;</svg>', '<svg a=1></svg>', '<svg foo></svg>', validRoot + '<!--</svg>']) {
    assert.throws(() => assertWellFormedXml(malformed));
  }
});

test("orphan artifacts важнее unsupported", async () => {
  const { classifyState } = await import("../../tools/lib/classify.mjs");
  const { STATE } = await import("../../tools/lib/constants.mjs");
  const classified = classifyState({
    server: { version: "0.0.0-unknown", uiDist: os.tmpdir() },
    manifestInspection: { status: "absent", manifest: null },
    targets: ["index.html"],
    live: new Map([["index.html", "<html><!-- PAPERCLIP_RU_OVERLAY --></html>"]]),
    dict: { fingerprint: "a".repeat(64) },
    panelResize: false,
    compat: { compatible: false, support: "none", reason: "unknown" },
    work: { root: path.join(os.tmpdir(), "missing-work"), manifest: path.join(os.tmpdir(), "missing-manifest.json") },
  });
  assert.equal(classified.state, STATE.CONFLICT);
  assert.equal(classified.reason, "orphaned-artifacts");
});

test("secret-scan: positive/negative fixtures без обхода собственного файла", async () => {
  const { scanText } = await import("../../tools/lib/secret-scan.mjs");
  const email = ["user", "example.com"].join("@");
  assert.ok(scanText(`contact ${email}`, "notes.md").some((h) => h.kind === "pii"));
  assert.equal(scanText("no secrets here", "notes.md").length, 0);
  const selfHits = scanText(fs.readFileSync(path.resolve("tools/lib/secret-scan.mjs"), "utf8"), path.resolve("tools/lib/secret-scan.mjs"));
  assert.equal(selfHits.length, 0);
});
