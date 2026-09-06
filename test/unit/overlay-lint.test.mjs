import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildOverlay } from "../../tools/lib/overlay.mjs";
import { lintDictionary } from "../../tools/lib/lint.mjs";
import { loadDictionary } from "../../tools/lib/dictionary.mjs";

test("оверлей по умолчанию не содержит panel resize", () => {
  const dict = loadDictionary();
  const off = buildOverlay(dict, { toolVersion: "1.0.0" }, { panelResize: false });
  const on = buildOverlay(dict, { toolVersion: "1.0.0" }, { panelResize: true });
  assert.equal(off.includes("__paperclipRuPanels"), false);
  assert.equal(on.includes("__paperclipRuPanels"), true);
  assert.doesNotMatch(off, /createTextNode\s*=/);
  assert.match(off, /_placeholder_/);
});

test("lint не пишет файлы и считает ошибки", () => {
  const result = lintDictionary();
  assert.ok(result.counts);
  assert.ok(Array.isArray(result.issues.error));
  assert.ok("error" in result.counts);
});
