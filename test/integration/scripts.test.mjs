import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PROJECT_ROOT, createTestRoot, runTool } from "../helpers/copy-fixture.mjs";

function run(file, args) {
  return new Promise((resolve) => {
    const isPs = file.endsWith(".ps1");
    const cmd = isPs ? "powershell" : findBash();
    if (!isPs && !cmd) {
      resolve({ code: 127, stdout: "", stderr: "bash not found" });
      return;
    }
    const full = isPs ? ["-NoProfile", "-File", file, ...args] : [file, ...args];
    const child = spawn(isPs ? "powershell" : cmd, full, { cwd: PROJECT_ROOT, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: String(err) }));
  });
}

function findBash() {
  const candidates = process.platform === "win32"
    ? [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    ]
    : ["bash"];
  for (const c of candidates) {
    if (c === "bash" || fs.existsSync(c)) return c;
  }
  return null;
}

function parseOneJson(stdout) {
  return JSON.parse(String(stdout).trim());
}

test("install.ps1 dry-run не пишет", async (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture на Windows");
    return;
  }
  const dest = path.join(createTestRoot("install-dry"), "dest");
  const res = await run(path.join(PROJECT_ROOT, "scripts", "install.ps1"), [
    "-DryRun", "-NonInteractive", "-Json", "-InstallDir", dest,
  ]);
  assert.equal(res.code, 0, res.stderr + res.stdout);
  assert.equal(fs.existsSync(dest), false);
  const doc = parseOneJson(res.stdout);
  assert.equal(doc.ok, true);
  assert.equal(doc.action, "install");
});

test("install.sh dry-run не пишет", async (t) => {
  const dest = path.join(createTestRoot("install-sh"), "dest");
  const res = await run(path.join(PROJECT_ROOT, "scripts", "install.sh"), [
    "--dry-run", "--non-interactive", "--json", "--install-dir", dest,
  ]);
  if (res.code === 127 || /bash not found|ENOENT/i.test(res.stderr)) {
    t.skip("bash недоступен");
    return;
  }
  assert.equal(res.code, 0, res.stderr + res.stdout);
  const doc = parseOneJson(res.stdout);
  assert.equal(doc.ok, true);
});

for (const extension of process.platform === 'win32' ? ['ps1', 'sh'] : ['sh']) {
  for (const mode of ['missing-value', 'unknown-flag']) {
    test(`${extension} wrapper ${mode} returns usage JSON and exit 2`, async () => {
      const args = extension === 'ps1' ? ['-Json', mode === 'missing-value' ? '-InstallDir' : '-UnknownFlag'] : ['--json', mode === 'missing-value' ? '--install-dir' : '--unknown-flag'];
      const result = await run(path.join(PROJECT_ROOT, 'scripts', `install.${extension}`), args);
      assert.equal(result.code, 2, result.stderr + result.stdout);
      const json = parseOneJson(result.stdout);
      assert.equal(json.ok, false);
      assert.equal(json.changed, false);
      assert.equal(typeof json.error, 'string');
    });
  }
}

test("неизвестный аргумент CLI = 2", async () => {
  const res = await runTool(["status", "--nope"]);
  assert.equal(res.code, 2);
});

test("нет Paperclip = 3", async () => {
  const missing = path.join(createTestRoot("missing-server"), "no-server");
  const res = await runTool(["status", "--json", "--server-dir", missing]);
  assert.equal(res.code, 3);
  const doc = parseOneJson(res.stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.compatible, false);
});
