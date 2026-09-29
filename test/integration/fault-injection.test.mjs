import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertInventoryUnchanged, createTestRoot, makeTempServer, runTool, treeHashes, treeInventory } from "../helpers/copy-fixture.mjs";
import { lifecycleJournalPath, recoverInterruptedLifecycle, writeOwnershipMarker } from "../../tools/lib/lifecycle.mjs";
import { OVERLAY_FILE, TOOL_VERSION } from "../../tools/lib/constants.mjs";
import { buildRelease } from "../../tools/lib/release-builder.mjs";

function jsonOut(res) {
  return JSON.parse(res.stdout.trim());
}

function apply(server, extra = [], env) {
  return runTool(["apply", "--json", "--server-dir", server, ...extra], env ? { env } : undefined);
}

test("corrupt manifest — conflict, ни одного изменения", async (t) => {
  const server = makeTempServer({ label: "bad-manifest", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const manifest = path.join(ui, ".paperclip-ru", "manifest.json");
  fs.writeFileSync(manifest, "{not-json");
  const before = treeHashes(ui);
  const res = await apply(server);
  const doc = jsonOut(res);
  assert.equal(res.code, 5, res.stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.changed, false);
  assert.equal(doc.baselineSafe, false);
  assert.deepEqual(treeHashes(ui), before);
});

test("missing manifest при orphaned overlay — conflict", async (t) => {
  const server = makeTempServer({ label: "orphan", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  fs.rmSync(path.join(ui, ".paperclip-ru"), { recursive: true, force: true });
  const res = await runTool(["verify", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.equal(doc.ok, false);
  assert.match(String(doc.stateAfter), /conflict/);
});

test("missing baseline — revert fail closed", async (t) => {
  const server = makeTempServer({ label: "miss-base", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const before = fs.readFileSync(path.join(ui, "assets", "app.js"));
  const baselineApp = path.join(ui, ".paperclip-ru", "baseline", "assets", "app.js");
  fs.rmSync(baselineApp);
  const res = await runTool(["revert", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(res.code, 5);
  assert.equal(doc.ok, false);
  assert.equal(doc.changed, false);
  assert.equal(doc.baselineSafe, false);
  assert.deepEqual(fs.readFileSync(path.join(ui, "assets", "app.js")), before);
  assert.equal(fs.existsSync(path.join(ui, ".paperclip-ru", "manifest.json")), true);
});

test("corrupt baseline hash — revert fail closed до записи", async (t) => {
  const server = makeTempServer({ label: "bad-base", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const before = fs.readFileSync(path.join(ui, "index.html"));
  fs.appendFileSync(path.join(ui, ".paperclip-ru", "baseline", "index.html"), "\n");
  const res = await runTool(["revert", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(res.code, 5);
  assert.equal(doc.ok, false);
  assert.equal(doc.changed, false);
  assert.deepEqual(fs.readFileSync(path.join(ui, "index.html")), before);
});

test("mixed live — verify fail", async (t) => {
  const server = makeTempServer({ label: "mixed", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const baselineApp = fs.readFileSync(path.join(ui, ".paperclip-ru", "baseline", "assets", "app.js"));
  fs.writeFileSync(path.join(ui, "assets", "app.js"), baselineApp);
  const res = await runTool(["verify", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.equal(doc.ok, false);
  assert.match(String(doc.stateAfter), /conflict/);
});

test("altered overlay — verify fail", async (t) => {
  const server = makeTempServer({ label: "overlay", t });
  jsonOut(await apply(server));
  const overlay = path.join(server, "ui-dist", "assets", OVERLAY_FILE);
  fs.appendFileSync(overlay, "\n/* tamper */\n");
  const res = await runTool(["verify", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.equal(doc.ok, false);
});

test("повторный apply — changed=false", async (t) => {
  const server = makeTempServer({ label: "idem", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const before = treeHashes(ui);
  const second = jsonOut(await apply(server));
  assert.equal(second.changed, false);
  assert.deepEqual(treeHashes(ui), before);
});

test("сбой write-overlay откатывает live", async (t) => {
  const server = makeTempServer({ label: "fp-overlay", t });
  const ui = path.join(server, "ui-dist");
  const before = treeHashes(ui);
  const res = await apply(server, [], { ...process.env, PAPERCLIP_RU_FAILPOINT: "write-overlay" });
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.equal(doc.ok, false);
  assert.equal(doc.changed, false);
  assert.deepEqual(treeHashes(ui), before);
  assert.equal(fs.existsSync(path.join(ui, "assets", OVERLAY_FILE)), false);
});

const FAILPOINTS = [
  "write-journal",
  "mkdir-work",
  "mkdir-staging",
  "write-staging:overlay",
  "write-staging:manifest",
  "mkdir-baseline",
  "write-baseline:index.html",
  "write-live:index.html",
  "write-live:assets/app.js",
  "write-overlay",
  "write-manifest",
  "remove-staging",
];

const EXTRA_FAILPOINTS = [
  "after:write-overlay",
  "after:write-live:index.html",
  "after:write-manifest",
  "after:write-staging:overlay",
  "after:write-staging:manifest",
  "after:remove-staging",
  "write-live:index.html#1",
  "write-journal#2",
  "after:write-journal",
  "permission:write-overlay",
  "after:post-apply-verify",
  "atomic-rename",
  "after:atomic-rename",
  "atomic-write-temp",
  "after:atomic-write-temp",
];

for (const step of FAILPOINTS) {
  test(`failpoint ${step} откатывает live`, async (t) => {
    const server = makeTempServer({ label: `fp-${step.replace(/[^a-z0-9]+/gi, "-")}`, t });
    const ui = path.join(server, "ui-dist");
    const before = treeInventory(ui);
    const res = await apply(server, [], { ...process.env, PAPERCLIP_RU_FAILPOINT: step });
    const doc = jsonOut(res);
    assert.notEqual(res.code, 0, step);
    assert.equal(doc.ok, false, step);
    assertInventoryUnchanged(before, ui);
    assert.equal(fs.existsSync(path.join(ui, "assets", OVERLAY_FILE)), false, step);
  });
}

for (const step of EXTRA_FAILPOINTS) {
  test(`failpoint ${step} откатывает live`, async (t) => {
    const server = makeTempServer({ label: `fp-x-${step.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}`, t });
    const ui = path.join(server, "ui-dist");
    const before = treeInventory(ui);
    const res = await apply(server, [], { ...process.env, PAPERCLIP_RU_FAILPOINT: step });
    const doc = jsonOut(res);
    assert.notEqual(res.code, 0, step);
    assert.equal(doc.ok, false, step);
    if (step.startsWith("permission:")) {
      assert.equal(res.code, 6, `${step} exit`);
    }
    assertInventoryUnchanged(before, ui);
    assert.equal(fs.existsSync(path.join(ui, "assets", OVERLAY_FILE)), false, step);
  });
}

const REVERT_FAILPOINTS = ["write-live:index.html", "remove:overlay", "remove-workdir"];
for (const step of REVERT_FAILPOINTS) {
  test(`revert failpoint ${step} откатывает live`, async (t) => {
    const server = makeTempServer({ label: `rfp-${step.replace(/[^a-z0-9]+/gi, "-")}`, t });
    jsonOut(await apply(server));
    const ui = path.join(server, "ui-dist");
    const before = treeHashes(ui);
    const res = await runTool(["revert", "--json", "--server-dir", server], {
      env: { ...process.env, PAPERCLIP_RU_FAILPOINT: step },
    });
    const doc = jsonOut(res);
    assert.notEqual(res.code, 0, step);
    assert.equal(doc.ok, false, step);
    assert.deepEqual(treeHashes(ui), before, step);
  });
}

test("install без checksum/manifest — fail", async (t) => {
  const server = makeTempServer({ label: "inst-src", t });
  const dest = path.join(server, "install-root");
  const res = await runTool([
    "install", "--json", "--source-dir", server, "--install-dir", dest, "--server-dir", server,
  ]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.equal(doc.ok, false);
  assert.equal(fs.existsSync(dest), false);
});

test("JSON success содержит error:null", async (t) => {
  const server = makeTempServer({ label: "json-null", t });
  const doc = jsonOut(await apply(server));
  assert.equal(doc.ok, true);
  assert.equal(doc.error, null);
  const status = jsonOut(await runTool(["status", "--json", "--server-dir", server]));
  assert.equal(status.error, null);
});

test("all-live-equal-baseline — conflict/partial", async (t) => {
  const server = makeTempServer({ label: "all-base", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(ui, ".paperclip-ru", "manifest.json"), "utf8"));
  for (const rel of manifest.ownedFiles) {
    fs.copyFileSync(path.join(ui, ".paperclip-ru", "baseline", rel), path.join(ui, rel));
  }
  const res = await runTool(["verify", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.match(String(doc.stateAfter), /conflict/);
});

test("install из ZIP вызывает установленный CLI", async (t) => {
  const root = createTestRoot("rel-install", t);
  const dist = path.join(root, "dist");
  buildRelease({ testBuild: true, outDir: dist });
  const server = makeTempServer({ label: "rel-srv", t });
  const installDir = path.join(root, "install");
  const res = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  const doc = jsonOut(res);
  assert.equal(res.code, 0, res.stderr + res.stdout);
  assert.equal(doc.ok, true);
  assert.equal(doc.action, "install");
  assert.ok(fs.existsSync(path.join(installDir, "tools", "paperclip-ru.mjs")));
  assert.ok(doc.child?.apply?.result || doc.child?.apply);
  assert.equal(doc.stateAfter, "applied/current");
});

let sharedDist = null;
function getSharedDist() {
  if (sharedDist) return sharedDist;
  const root = createTestRoot("shared-rel");
  sharedDist = path.join(root, "dist");
  buildRelease({ testBuild: true, outDir: sharedDist });
  return sharedDist;
}

const LIFECYCLE_FAILPOINTS = [
  "write-lifecycle-journal",
  "after:write-lifecycle-journal",
  "write-lifecycle-journal#2",
  "npm-ci",
  "rename-install-to-prev",
  "after:rename-install-to-prev",
  "rename-stage-to-install",
  "after:rename-stage-to-install",
  "remove-prev",
];

for (const step of LIFECYCLE_FAILPOINTS) {
  test(`install failpoint ${step}`, async (t) => {
    const dist = getSharedDist();
    const root = createTestRoot(`lfp-${step.replace(/[^a-z0-9]+/gi, "-")}`, t);
    const server = makeTempServer({ label: `lfp-s-${step.replace(/[^a-z0-9]+/gi, "-").slice(0, 16)}`, t });
    const installDir = path.join(root, "install");
    if (step === "rename-install-to-prev" || step === "after:rename-install-to-prev" || step === "remove-prev") {
      const first = await runTool([
        "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
      ]);
      assert.equal(first.code, 0, first.stderr + first.stdout);
    }
    const beforeUi = treeInventory(path.join(server, "ui-dist"));
    const res = await runTool([
      step === "rename-install-to-prev" || step === "after:rename-install-to-prev" || step === "remove-prev" ? "update" : "install",
      "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
    ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: step } });
    const doc = jsonOut(res);
    assert.notEqual(res.code, 0, step);
    assert.equal(doc.ok, false, step);
    if (step === "write-lifecycle-journal" || step === "after:write-lifecycle-journal" || step === "npm-ci" || step === "rename-stage-to-install") {
      assert.equal(fs.existsSync(installDir), false, step);
    }
    if (step === "after:rename-install-to-prev") {
      assert.equal(fs.existsSync(installDir), true, step);
      assert.ok(fs.existsSync(path.join(installDir, "tools", "paperclip-ru.mjs")), step);
      assert.equal(fs.existsSync(`${installDir}.prev`), false, step);
    }
    if (step === "write-lifecycle-journal" || step === "npm-ci") {
      assertInventoryUnchanged(beforeUi, path.join(server, "ui-dist"));
    }
  });
}

test("uninstall failpoint uninstall-owned-remove восстанавливает исходное состояние", async (t) => {
  const dist = getSharedDist();
  const root = createTestRoot("un-own", t);
  const server = makeTempServer({ label: "un-own-s", t });
  const installDir = path.join(root, "install");
  const first = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  const res = await runTool([
    "uninstall", "--json", "--install-dir", installDir, "--server-dir", server,
  ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "uninstall-owned-remove" } });
  assert.notEqual(res.code, 0);
  assert.equal(jsonOut(res).ok, false);
  assert.equal(jsonOut(res).details.rollbackOk, true);
  assert.equal(fs.existsSync(installDir), true);
  assert.equal(fs.existsSync(`${installDir}.deleting`), false);
  assert.equal(fs.existsSync(lifecycleJournalPath(installDir)), false);
});

test("uninstall failpoint uninstall-remove не удаляет root", async (t) => {
  const dist = getSharedDist();
  const root = createTestRoot("un-rm", t);
  const server = makeTempServer({ label: "un-rm-s", t });
  const installDir = path.join(root, "install");
  const first = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  const res = await runTool([
    "uninstall", "--json", "--install-dir", installDir, "--server-dir", server,
  ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "uninstall-remove" } });
  assert.notEqual(res.code, 0);
  assert.equal(jsonOut(res).ok, false);
  assert.equal(fs.existsSync(installDir), true);
  assert.ok(fs.existsSync(path.join(installDir, "tools", "paperclip-ru.mjs")));
});

test("uninstall failpoint after:uninstall-owned-remove восстанавливает исходное состояние", async (t) => {
  const dist = getSharedDist();
  const root = createTestRoot("un-own-after", t);
  const server = makeTempServer({ label: "un-own-a-s", t });
  const installDir = path.join(root, "install");
  const first = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  const res = await runTool([
    "uninstall", "--json", "--install-dir", installDir, "--server-dir", server,
  ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "after:uninstall-owned-remove" } });
  assert.notEqual(res.code, 0);
  assert.equal(jsonOut(res).ok, false);
  assert.equal(jsonOut(res).details.rollbackOk, true);
  assert.equal(fs.existsSync(installDir), true);
  assert.equal(fs.existsSync(`${installDir}.deleting`), false);
  assert.equal(fs.existsSync(lifecycleJournalPath(installDir)), false);
});

test("uninstall failpoint after:uninstall-remove не удаляет доказанный root", async (t) => {
  const dist = getSharedDist();
  const root = createTestRoot("un-rm-after", t);
  const server = makeTempServer({ label: "un-rm-a-s", t });
  const installDir = path.join(root, "install");
  const first = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  const res = await runTool([
    "uninstall", "--json", "--install-dir", installDir, "--server-dir", server,
  ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "after:uninstall-remove" } });
  assert.notEqual(res.code, 0);
  assert.equal(jsonOut(res).ok, false);
  const rec = recoverInterruptedLifecycle(installDir);
  assert.equal(jsonOut(res).details.rollbackOk, true);
  assert.equal(rec.recovered, false);
  assert.equal(fs.existsSync(installDir), true);
  assert.equal(fs.existsSync(`${installDir}.deleting`), false);
  assert.ok(fs.existsSync(path.join(installDir, "tools", "paperclip-ru.mjs")));
});

test("legacy journal without complete snapshots fails closed", async (t) => {
  const root = createTestRoot("legacy-journal", t);
  const installDir = path.join(root, "install");
  const prev = `${installDir}.prev`;
  for (const [dir, text] of [[installDir, "new"], [prev, "old"]]) {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "payload.txt"), text);
  }
  const file = lifecycleJournalPath(installDir);
  t.after(() => fs.rmSync(file, { force: true }));
  fs.writeFileSync(file, JSON.stringify({ schema: "paperclip-ru-lifecycle-journal/v1", stage: "new-root-activated", installDir }));
  const before = treeInventory(root);
  for (const dryRun of [true, false]) {
    const rec = recoverInterruptedLifecycle(installDir, { dryRun });
    assert.equal(rec.recovered, false);
    assert.equal(rec.blocked, true);
    assertInventoryUnchanged(before, root);
  }
});

test("update after:cli:apply восстанавливает previous tool bytes", async (t) => {
  const dist = getSharedDist();
  const root = createTestRoot("upd-prev-bytes", t);
  const server = makeTempServer({ label: "upd-prev-s", t });
  const installDir = path.join(root, "install");
  const first = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  const cli = path.join(installDir, "tools", "paperclip-ru.mjs");
  fs.appendFileSync(cli, "\n// previous-root-stamp\n");
  writeOwnershipMarker(installDir);
  const beforeCli = fs.readFileSync(cli);
  const beforeUi = treeInventory(path.join(server, "ui-dist"));
  const res = await runTool([
    "update", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: "after:cli:apply" } });
  assert.notEqual(res.code, 0);
  assert.equal(jsonOut(res).ok, false);
  assert.equal(fs.existsSync(`${installDir}.prev`), false);
  assert.deepEqual(fs.readFileSync(cli), beforeCli);
  assertInventoryUnchanged(beforeUi, path.join(server, "ui-dist"));
  assert.match(beforeCli.toString("utf8"), /previous-root-stamp/);
});

test("uninstall child failpoints не удаляют install root", async (t) => {
  const dist = getSharedDist();
  for (const [step, label] of [
    ["cli:status", "1"],
    ["cli:verify", "1"],
    ["permission:cli:verify", "6"],
  ]) {
    const root = createTestRoot(`un-ch-${label}-${step.replace(/[^a-z0-9]+/gi, "-").slice(0, 12)}`, t);
    const server = makeTempServer({ label: `un-ch-${label}`, t });
    const installDir = path.join(root, "install");
    const first = await runTool([
      "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
    ]);
    assert.equal(first.code, 0, first.stderr);
    const res = await runTool([
      "uninstall", "--json", "--install-dir", installDir, "--server-dir", server,
    ], { env: { ...process.env, PAPERCLIP_RU_FAILPOINT: step } });
    assert.notEqual(res.code, 0, step);
    assert.equal(jsonOut(res).ok, false, step);
    assert.equal(fs.existsSync(installDir), true, step);
  }
});

test("uninstall child exit 3/4/5 не удаляют install root", async (t) => {
  const dist = getSharedDist();
  const cases = [
    ["3", (ctx) => ({ serverDir: path.join(ctx.root, "missing-server") })],
    ["4", (ctx) => {
      const pkg = path.join(ctx.server, "package.json");
      const raw = JSON.parse(fs.readFileSync(pkg, "utf8"));
      raw.version = "0.0.0-unknown";
      fs.writeFileSync(pkg, `${JSON.stringify(raw, null, 2)}\n`);
      return { serverDir: ctx.server };
    }],
    ["5", (ctx) => {
      fs.writeFileSync(path.join(ctx.server, "ui-dist", ".paperclip-ru", "manifest.json"), "{not-json");
      return { serverDir: ctx.server };
    }],
  ];
  for (const [code, prep] of cases) {
    const root = createTestRoot(`un-ex-${code}`, t);
    const server = makeTempServer({ label: `un-ex-${code}`, t });
    const installDir = path.join(root, "install");
    const first = await runTool([
      "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
    ]);
    assert.equal(first.code, 0, first.stderr);
    const extra = prep({ root, server, installDir });
    const res = await runTool([
      "uninstall", "--json", "--install-dir", installDir, "--server-dir", extra.serverDir,
    ]);
    assert.equal(res.code, Number(code), `${code}: ${res.stdout}`);
    assert.equal(jsonOut(res).ok, false, code);
    assert.equal(fs.existsSync(installDir), true, code);
  }
});

test("coverage отвергает пустой route-matrix {}", async () => {
  const { buildCoverageReport } = await import("../../tools/lib/coverage.mjs");
  const bogus = path.join(createTestRoot("cov-empty"), "empty.json");
  fs.writeFileSync(bogus, "{}\n");
  assert.throws(() => buildCoverageReport({ routeMatrix: bogus }), /неполная schema/);
});

test("apply: unsupported + orphan overlay — conflict 5, не unsupported", async (t) => {
  const server = makeTempServer({ label: "app-unsup-orphan", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  fs.rmSync(path.join(ui, ".paperclip-ru"), { recursive: true, force: true });
  const pkg = path.join(server, "package.json");
  const raw = JSON.parse(fs.readFileSync(pkg, "utf8"));
  raw.version = "0.0.0-unknown";
  fs.writeFileSync(pkg, `${JSON.stringify(raw, null, 2)}\n`);
  const before = treeInventory(ui);
  const res = await apply(server);
  const doc = jsonOut(res);
  assert.equal(res.code, 5, res.stdout);
  assert.equal(doc.ok, false);
  assert.notEqual(doc.stateAfter, "unsupported");
  assert.match(String(doc.stateAfter), /conflict/);
  assertInventoryUnchanged(before, ui);
});

test("revert: valid manifest + unsupported — exit 4 без записи", async (t) => {
  const server = makeTempServer({ label: "rev-unsup-valid", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  const pkg = path.join(server, "package.json");
  const raw = JSON.parse(fs.readFileSync(pkg, "utf8"));
  raw.version = "0.0.0-unknown";
  fs.writeFileSync(pkg, `${JSON.stringify(raw, null, 2)}\n`);
  const before = treeInventory(ui);
  const res = await runTool(["revert", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(res.code, 4, res.stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.stateAfter, "unsupported");
  assert.notEqual(doc.verification?.byteIdentical, true);
  assertInventoryUnchanged(before, ui);
});

test("revert отказывается от unsupported+orphan без byteIdentical", async (t) => {
  const server = makeTempServer({ label: "rev-unsup", t });
  jsonOut(await apply(server));
  const ui = path.join(server, "ui-dist");
  fs.rmSync(path.join(ui, ".paperclip-ru"), { recursive: true, force: true });
  const pkg = path.join(server, "package.json");
  const raw = JSON.parse(fs.readFileSync(pkg, "utf8"));
  raw.version = "0.0.0-unknown";
  fs.writeFileSync(pkg, `${JSON.stringify(raw, null, 2)}\n`);
  const before = treeHashes(ui);
  const res = await runTool(["revert", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0);
  assert.equal(doc.ok, false);
  assert.notEqual(doc.stateAfter, "installed_not_applied");
  assert.notEqual(doc.verification?.byteIdentical, true);
  assert.deepEqual(treeHashes(ui), before);
});

test("update сравнивает installed и selected version", async (t) => {
  const dist = getSharedDist();
  const root = createTestRoot("upd-ver", t);
  const server = makeTempServer({ label: "upd-ver-s", t });
  const installDir = path.join(root, "install");
  const first = await runTool([
    "install", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  const res = await runTool([
    "update", "--json", "--source-dir", dist, "--install-dir", installDir, "--server-dir", server,
  ]);
  const doc = jsonOut(res);
  assert.equal(res.code, 0, res.stderr + res.stdout);
  assert.equal(doc.installedVersion, doc.selectedVersion);
  assert.ok((doc.warnings || []).some((w) => /совпадает с выбранной/.test(w)));
});

test("release bytes детерминированы при SOURCE_DATE_EPOCH", async (t) => {
  const prev = process.env.SOURCE_DATE_EPOCH;
  process.env.SOURCE_DATE_EPOCH = "1746403200";
  try {
    const a = path.join(createTestRoot("rel-a", t), "dist");
    const b = path.join(createTestRoot("rel-b", t), "dist");
    const { sha256 } = await import("../../tools/lib/fs-atomic.mjs");
    buildRelease({ testBuild: true, outDir: a });
    buildRelease({ testBuild: true, outDir: b });
    for (const name of [`paperclip-ru-${TOOL_VERSION}.zip`, `paperclip-ru-${TOOL_VERSION}.tar.gz`, "release-manifest.json"]) {
      assert.equal(sha256(fs.readFileSync(path.join(a, name))), sha256(fs.readFileSync(path.join(b, name))), name);
    }
  } finally {
    if (prev == null) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = prev;
  }
});

test("coverage отвергает route-matrix с errors/leaks", async () => {
  const { buildCoverageReport } = await import("../../tools/lib/coverage.mjs");
  const file = path.join(createTestRoot("cov-leaks"), "leaks.json");
  fs.writeFileSync(file, `${JSON.stringify({
    schema: "paperclip-ru-route-matrix/v1",
    provenance: { generator: "test", synthetic: true },
    timestamp: "2026-09-04T00:00:00.000Z",
    paperclipVersion: "2026.831.1-synthetic",
    routes: [{ route: "/CMP/dashboard" }],
    errors: [{ type: "pageerror", message: "x" }],
    runtimeLeaks: [],
  })}\n`);
  assert.throws(() => buildCoverageReport({ routeMatrix: file }), /errors\/runtimeLeaks/);
});
