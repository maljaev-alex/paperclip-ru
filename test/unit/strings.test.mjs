import test from "node:test";
import assert from "node:assert/strict";
import { extractOccurrences, applyDictionary, blockReason } from "../../tools/lib/strings.mjs";

function occ(code, value) {
  return extractOccurrences(code).filter((o) => o.value === value);
}

test("object keys не патчатся", () => {
  const code = `const x = { "Dashboard": 1 };`;
  const [hit] = occ(code, "Dashboard");
  assert.equal(hit.block, "object-key");
});

test("computed object and class keys retain their JavaScript identity", () => {
  const key = "Current budget limit";
  const dictionary = new Map([[key, "Текущий лимит бюджета"]]);
  for (const code of [
    `const x = { [${JSON.stringify(key)}]: 1 };`,
    `const x = { [\`${key}\`]: 1 };`,
    `const x = { [${JSON.stringify(key)} + suffix]: 1 };`,
    `class X { [${JSON.stringify(key)}] = 1; }`,
    `class X { [${JSON.stringify(key)}]() { return 1; } }`,
  ]) {
    const result = applyDictionary(code, extractOccurrences(code), dictionary);
    assert.equal(result.code, code);
    assert.equal(result.replacements, 0);
  }
});

test("comparisons и switch case блокируются", () => {
  const cmp = extractOccurrences(`if (x === "open") {}`);
  assert.ok(cmp.some((o) => o.block === "comparison"));
  const sw = extractOccurrences(`switch (x) { case "todo": break; }`);
  assert.ok(sw.some((o) => o.block === "switch-case"));
});

test("selectors, storage keys, routes, import paths", () => {
  assert.ok(extractOccurrences(`document.querySelector(".board")`).some((o) => o.block === "dom-selector"));
  assert.ok(extractOccurrences(`localStorage.getItem("theme")`).some((o) => o.block === "dom-selector"));
  const route = extractOccurrences(`const r = { href: "/CMP/issues" };`);
  assert.ok(route.some((o) => String(o.block).includes("semantic-key")));
});

test("tagged template блокируется, обычный quasi — нет", () => {
  const tagged = extractOccurrences("css`color: red`");
  assert.ok(tagged.some((o) => o.block === "tagged-template"));
  const raw = extractOccurrences("const s = `Hello world from dashboard page.`");
  assert.ok(raw.some((o) => o.kind === "quasi" && !o.block));
});

test("экранирование кавычек, backticks и ${}", () => {
  const dict = new Map([["Say `hi` and ${x}", 'Скажи `привет` и ${x}']]);
  const code = "const s = \"Say `hi` and ${x}\"; const t = `long enough display text here ok`;";
  const occurrences = extractOccurrences(code);
  const { code: out } = applyDictionary(code, occurrences, dict, {});
  assert.match(out, /Скажи/);
});

test("display-safe: UI key заменяется, короткий ключ без UI — нет", () => {
  const code = `const a = { title: "Dashboard" }; const b = "Open";`;
  const dict = new Map([["Dashboard", "Обзор"], ["Open", "Открыть"]]);
  const occurrences = extractOccurrences(code);
  const { code: out, replacements } = applyDictionary(code, occurrences, dict, {});
  assert.match(out, /Обзор/);
  assert.doesNotMatch(out, /Открыть/);
  assert.equal(replacements, 1);
});

test("systemPrompt не заменяется", () => {
  const code = `const x = { systemPrompt: "You are the CEO. Keep this English instruction here for the model." };`;
  const dict = new Map([["You are the CEO. Keep this English instruction here for the model.", "Вы CEO"]]);
  const occurrences = extractOccurrences(code);
  const { replacements } = applyDictionary(code, occurrences, dict, {});
  assert.equal(replacements, 0);
  assert.ok(occurrences.some((o) => String(o.block).includes("semantic-key")));
});

test("blockReason экспортирован", () => {
  assert.equal(typeof blockReason, "function");
});
