import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertInventoryUnchanged, makeTempServer, runTool, treeInventory } from "../helpers/copy-fixture.mjs";

function jsonOut(res) {
  return JSON.parse(res.stdout.trim());
}

function manifestPath(server) {
  return path.join(server, "ui-dist", ".paperclip-ru", "manifest.json");
}

function readManifest(server) {
  return JSON.parse(fs.readFileSync(manifestPath(server), "utf8"));
}

function writeManifest(server, raw) {
  fs.writeFileSync(manifestPath(server), `${JSON.stringify(raw, null, 2)}\n`);
}

const CASES = [
  ["manifest-empty-files", (m) => ({ ...m, files: {} })],
  ["manifest-missing-overlay-hash", (m) => ({ ...m, overlayHash: null })],
  ["manifest-missing-tool-version", (m) => ({ ...m, toolVersion: "" })],
  ["manifest-owned-files-mismatch", (m) => ({ ...m, ownedFiles: ["index.html"] })],
  ["manifest-duplicate-owned-file", (m) => ({ ...m, ownedFiles: ["index.html", "index.html"] })],
  ["manifest-dotdot", (m) => ({
    ...m,
    files: { "../../outside": m.files["index.html"] },
    ownedFiles: ["../../outside"],
    inspectedTargets: ["../../outside"],
  })],
  ["manifest-absolute-windows", (m) => ({
    ...m,
    files: { "C:/Windows/abs.js": m.files["index.html"] },
    ownedFiles: ["C:/Windows/abs.js"],
    inspectedTargets: ["C:/Windows/abs.js"],
  })],
  ["manifest-absolute-posix", (m) => ({
    ...m,
    files: { "/etc/passwd": m.files["index.html"] },
    ownedFiles: ["/etc/passwd"],
    inspectedTargets: ["/etc/passwd"],
  })],
  ["manifest-unknown-schema", (m) => ({ ...m, schema: "paperclip-ru-manifest/v99" })],
  ["legacy-v2-cannot-bypass-v3", (m) => ({
    schema: "paperclip-ru-manifest/v2",
    tool: m.tool,
    toolVersion: m.toolVersion,
    files: m.files,
  })],
];

for (const [name, mutate] of CASES) {
  test(name, async (t) => {
    const server = makeTempServer({ label: name, t });
    const applied = await runTool(["apply", "--json", "--server-dir", server]);
    assert.equal(applied.code, 0, applied.stderr + applied.stdout);
    writeManifest(server, mutate(readManifest(server)));
    const ui = path.join(server, "ui-dist");
    const before = treeInventory(ui);
    const res = await runTool(["apply", "--json", "--server-dir", server]);
    const doc = jsonOut(res);
    assert.equal(res.code, 5, `${name}: ${res.stdout}`);
    assert.equal(doc.ok, false, name);
    assert.equal(doc.changed, false, name);
    assert.equal(doc.baselineSafe, false, name);
    assert.match(String(doc.stateAfter), /conflict/, name);
    assertInventoryUnchanged(before, ui);
  });
}
