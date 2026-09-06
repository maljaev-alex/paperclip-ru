import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { PROJECT_ROOT, makeTempServer, runTool } from "../helpers/copy-fixture.mjs";
import { OVERLAY_FILE } from "../../tools/lib/constants.mjs";

const AGENTS = fs.readFileSync(path.join(PROJECT_ROOT, "AGENTS.md"), "utf8").replace(/\\/g, "/");

const COMMANDS = ["doctor", "status", "verify", "apply", "reapply", "revert", "extract", "report", "install", "update", "uninstall"];
const FLAGS = ["--json", "--dry-run", "--server-dir", "--with-panel-resize"];

test("AGENTS.md ссылается на реальные команды и флаги", () => {
  for (const c of COMMANDS) assert.match(AGENTS, new RegExp(`paperclip-ru ${c}`));
  for (const f of FLAGS) assert.match(AGENTS, new RegExp(f.replace(/-/g, "\\-")));
  assert.match(AGENTS, /SHA256SUMS/);
  assert.match(AGENTS, /scripts\/install\.ps1/);
  assert.match(AGENTS, /scripts\/install\.sh/);
});

test("lifecycle: detect -> dry-run -> apply -> verify -> reapply -> revert", async () => {
  const server = makeTempServer({ label: "lifecycle" });
  const doctor = await runTool(["doctor", "--json", "--server-dir", server]);
  assert.equal(doctor.code, 0, doctor.stderr);
  const dry = await runTool(["apply", "--dry-run", "--json", "--server-dir", server]);
  assert.equal(JSON.parse(dry.stdout).changed, false);
  const apply = await runTool(["apply", "--json", "--server-dir", server]);
  assert.equal(JSON.parse(apply.stdout).ok, true);
  const verify = await runTool(["verify", "--json", "--server-dir", server]);
  assert.equal(JSON.parse(verify.stdout).ok, true);
  const reapply = await runTool(["reapply", "--json", "--server-dir", server]);
  assert.equal(JSON.parse(reapply.stdout).ok, true);
  const revert = await runTool(["revert", "--json", "--server-dir", server]);
  assert.equal(JSON.parse(revert.stdout).verification.byteIdentical, true);
});

test("JSON контракт содержит обязательные поля", async () => {
  const server = makeTempServer({ label: "json-schema" });
  const doc = JSON.parse((await runTool(["apply", "--dry-run", "--json", "--server-dir", server])).stdout);
  for (const key of ["ok", "action", "changed", "stateBefore", "stateAfter", "paperclipVersion", "toolVersion", "compatible", "targetDir", "baselineSafe", "verification", "warnings", "nextAction", "error"]) {
    assert.ok(key in doc, key);
  }
});

test("browser overlay smoke: lang, placeholder, без panel hooks", async (t) => {
  const server = makeTempServer({ label: "browser" });
  await runTool(["apply", "--json", "--server-dir", server]);
  const ui = path.join(server, "ui-dist");
  const overlay = fs.readFileSync(path.join(ui, "assets", OVERLAY_FILE), "utf8");
  assert.doesNotMatch(overlay, /pc-ru-resize-handle/);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Paperclip</title>
  <script>${overlay}</script></head>
  <body>
    <div data-route="dashboard"><h1>Dashboard</h1></div>
    <div class="placeholder">Message the agent — describe what you want done…</div>
    <div class="_contentEditable_er3ed_379 _placeholder_er3ed_1105 paperclip-mdxeditor-content">Message the agent — describe what you want done…</div>
    <textarea>AGENTS.md must stay</textarea>
    <pre><code>const x = "Open";</code></pre>
  </body></html>`;
  const pagePath = path.join(ui, "smoke.html");
  fs.writeFileSync(pagePath, html);

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    assert.fail("playwright обязателен в package-lock.json; source inspection не засчитывается");
  }

  const browser = await playwright.chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  const serverHttp = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => serverHttp.listen(0, "127.0.0.1", r));
  const { port } = serverHttp.address();
  await page.goto(`http://127.0.0.1:${port}/`);
  const lang = await page.locator("html").getAttribute("lang");
  assert.equal(lang, "ru");
  const h1 = await page.locator("h1").innerText();
  assert.equal(h1, "Обзор");
  const ph = await page.locator(".placeholder").innerText();
  assert.match(ph, /агенту|Напишите/);
  const hashed = await page.locator("._placeholder_er3ed_1105").innerText();
  assert.match(hashed, /агенту|Напишите/);
  const ta = await page.locator("textarea").inputValue();
  assert.match(ta, /AGENTS\.md must stay/);
  assert.equal(errors.join("\n"), "");
  await browser.close();
  serverHttp.close();
});

test("выключенный resize не оставляет DOM-хуков в оверлее", async () => {
  const server = makeTempServer({ label: "panels-off" });
  await runTool(["apply", "--json", "--server-dir", server]);
  const overlay = fs.readFileSync(path.join(server, "ui-dist", "assets", OVERLAY_FILE), "utf8");
  assert.doesNotMatch(overlay, /__paperclipRuPanels/);
  await runTool(["apply", "--json", "--with-panel-resize", "--server-dir", server]);
  const on = fs.readFileSync(path.join(server, "ui-dist", "assets", OVERLAY_FILE), "utf8");
  assert.match(on, /__paperclipRuPanels/);
});
