import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempServer, runTool, shaFile, treeHashes } from "../helpers/copy-fixture.mjs";
import { OVERLAY_FILE } from "../../tools/lib/constants.mjs";

function jsonOut(res) {
  const line = res.stdout.trim().split(/\n/).pop();
  return JSON.parse(line);
}

test("status на чистой fixture", async (t) => {
  const server = makeTempServer({ label: "status", t });
  const res = await runTool(["status", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(doc.stateAfter, "installed_not_applied");
  assert.equal(doc.changed, false);
});

test("apply --dry-run не меняет ни одного байта", async (t) => {
  const server = makeTempServer({ label: "dry", t });
  const ui = path.join(server, "ui-dist");
  const before = treeHashes(ui);
  const res = await runTool(["apply", "--dry-run", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(res.code, 0, res.stderr + res.stdout);
  assert.equal(doc.changed, false);
  assert.deepEqual(treeHashes(ui), before);
});

test("первый apply меняет только ожидаемые файлы, второй идемпотентен, revert побайтовый", async (t) => {
  const server = makeTempServer({ label: "apply", t });
  const ui = path.join(server, "ui-dist");
  const original = treeHashes(ui);

  const first = jsonOut(await runTool(["apply", "--json", "--server-dir", server]));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.stateAfter, "applied/current");
  const afterFirst = treeHashes(ui);
  assert.notDeepEqual(afterFirst, original);
  assert.equal(fs.existsSync(path.join(ui, "assets", OVERLAY_FILE)), true);

  const html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  assert.match(html, /PAPERCLIP_RU_OVERLAY/);
  assert.match(html, /lang="ru"/);

  const app = fs.readFileSync(path.join(ui, "assets", "app.js"), "utf8");
  assert.match(app, /Обзор|Dashboard/);
  assert.match(app, /status: "open"/);
  assert.match(app, /href: "\/CMP\/issues"/);
  assert.doesNotMatch(app, /systemPrompt: "Вы /);

  const second = jsonOut(await runTool(["apply", "--json", "--server-dir", server]));
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.deepEqual(treeHashes(ui), afterFirst);

  const reverted = jsonOut(await runTool(["revert", "--json", "--server-dir", server]));
  assert.equal(reverted.ok, true, reverted.error);
  assert.equal(reverted.verification.byteIdentical, true);
  assert.deepEqual(treeHashes(ui), original);
  assert.equal(fs.existsSync(path.join(ui, "assets", OVERLAY_FILE)), false);
});

test("повреждённый live-файл вызывает отказ без частичной записи", async (t) => {
  const server = makeTempServer({ label: "conflict", t });
  const ui = path.join(server, "ui-dist");
  jsonOut(await runTool(["apply", "--json", "--server-dir", server]));
  const appPath = path.join(ui, "assets", "app.js");
  const before = fs.readFileSync(appPath);
  fs.appendFileSync(appPath, "\n/* tamper */\n");
  const res = await runTool(["apply", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(res.code, 5, res.stdout + res.stderr);
  assert.equal(doc.ok, false);
  const after = fs.readFileSync(appPath);
  assert.ok(after.includes("tamper"));
  assert.notEqual(shaFile(appPath), shaFile(path.join(server, "ui-dist", ".paperclip-ru", "baseline", "assets", "app.js")));
  void before;
});

test("лишний chunk при official fingerprint — conflict, не silent reapply", async (t) => {
  const server = makeTempServer({ label: "chunks", t });
  jsonOut(await runTool(["apply", "--json", "--server-dir", server]));
  const extra = path.join(server, "ui-dist", "assets", "chunk-new.js");
  fs.writeFileSync(extra, `export const labels = { title: "Dashboard" };\n`);
  const res = await runTool(["reapply", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.notEqual(res.code, 0, res.stdout + res.stderr);
  assert.equal(doc.ok, false);
  assert.match(String(doc.stateAfter || doc.error), /conflict|extra|fingerprint/i);
});

test("--force-baseline требует явного флага", async (t) => {
  const server = makeTempServer({ label: "force", t });
  const dry = jsonOut(await runTool(["apply", "--dry-run", "--force-baseline", "--json", "--server-dir", server]));
  assert.equal(dry.ok, true);
  assert.ok((dry.warnings || []).some((w) => /force-baseline/i.test(w)));
});

test("путь с пробелами и кириллицей", async (t) => {
  const server = makeTempServer({ label: "кириллица", cyrillic: true, t });
  const res = await runTool(["apply", "--json", "--server-dir", server]);
  const doc = jsonOut(res);
  assert.equal(doc.ok, true, res.stderr + res.stdout);
  const rev = jsonOut(await runTool(["revert", "--json", "--server-dir", server]));
  assert.equal(rev.verification.byteIdentical, true);
});

test("doctor/verify ничего не меняют", async (t) => {
  const server = makeTempServer({ label: "readonly", t });
  const ui = path.join(server, "ui-dist");
  const before = treeHashes(ui);
  await runTool(["doctor", "--json", "--server-dir", server]);
  await runTool(["verify", "--json", "--server-dir", server]);
  assert.deepEqual(treeHashes(ui), before);
});
