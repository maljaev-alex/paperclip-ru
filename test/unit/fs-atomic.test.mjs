import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createTestRoot } from "../helpers/copy-fixture.mjs";
import { atomicWriteFile } from "../../tools/lib/fs-atomic.mjs";

test("atomic replacement preserves existing modes under a restrictive umask", { skip: process.platform === "win32" ? "POSIX umask" : false }, (t) => {
  const root = createTestRoot("atomic-mode", t);
  const target = path.join(root, "private.js");
  fs.writeFileSync(target, "before");
  fs.chmodSync(target, 0o640);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { atomicWriteFile } from ${JSON.stringify(new URL("../../tools/lib/fs-atomic.mjs", import.meta.url).href)};
    process.umask(0o077);
    atomicWriteFile(process.argv[1], "after");
  `, target], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(target, "utf8"), "after");
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
});

test("Windows atomic replacement tolerates a short-lived reader that denies delete sharing", { skip: process.platform !== "win32" ? "Windows file sharing" : false }, async (t) => {
  const root = createTestRoot("atomic-sharing", t);
  const target = path.join(root, "journal.json");
  const script = path.join(root, "reader.ps1");
  fs.writeFileSync(target, "before");
  fs.writeFileSync(script, `param([string]$Target)
    $stream = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      [Console]::Out.WriteLine('READY')
      [Console]::Out.Flush()
      [Console]::ReadLine() | Out-Null
    } finally { $stream.Dispose() }
  `);
  const reader = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script, target], { windowsHide: true });
  const closed = new Promise((resolve) => reader.once("close", resolve));
  t.after(async () => { if (reader.exitCode === null) reader.kill(); await closed; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("reader readiness timed out")), 5000);
    reader.once("error", (error) => { clearTimeout(timeout); reject(error); });
    reader.stdout.on("data", (data) => { if (String(data).includes("READY")) { clearTimeout(timeout); resolve(); } });
  });
  const rename = fs.renameSync;
  let sawSharingError = false;
  fs.renameSync = (...args) => {
    try { return rename(...args); }
    catch (error) {
      if (["EPERM", "EACCES", "EBUSY"].includes(error.code)) {
        sawSharingError = true;
        if (!reader.stdin.writableEnded) reader.stdin.end("release\n");
      }
      throw error;
    }
  };
  try { atomicWriteFile(target, "after"); }
  finally {
    fs.renameSync = rename;
    if (!reader.stdin.writableEnded) reader.stdin.end("release\n");
  }
  await closed;
  assert.equal(sawSharingError, true, "The test must exercise a real Windows sharing error");
  assert.equal(fs.readFileSync(target, "utf8"), "after");
});
