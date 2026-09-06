import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadDictionary } from "../../tools/lib/dictionary.mjs";
import { buildOverlay } from "../../tools/lib/overlay.mjs";

test("unknown prototype names stay literal", async (t) => {
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: buildOverlay(loadDictionary(), { toolVersion: "test" }) });
  for (const value of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
    assert.equal(await page.evaluate((text) => window.__paperclipRu.translate(text), value), value);
  }
  assert.deepEqual(errors, []);
});

test("generated dictionaries preserve dollar tokens and special keys", async (t) => {
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  t.after(() => browser.close());
  const errors = [];
  const custom = await browser.newPage();
  custom.on("pageerror", (error) => errors.push(String(error)));
  await custom.setContent("<!doctype html><html><body></body></html>");
  const value = "Буквально $& / $` / $' / $$ / $1 и __RULES__ / __META__";
  await custom.addScriptTag({ content: buildOverlay({
    exact: new Map([["Sample translation", value], ["__proto__", "Прототип"], ["constructor", "Конструктор"]]),
    rules: [], plurals: {},
  }, { toolVersion: "test" }) });
  assert.equal(await custom.evaluate(() => window.__paperclipRu.translate("Sample translation")), value);
  assert.equal(await custom.evaluate(() => window.__paperclipRu.translate("__proto__")), "Прототип");
  assert.equal(await custom.evaluate(() => window.__paperclipRu.translate("constructor")), "Конструктор");
  assert.deepEqual(errors, []);
});
