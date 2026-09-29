import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyLintBaseline, findingId } from "../../tools/lib/lint-baseline.mjs";
import { lintDictionary } from "../../tools/lib/lint.mjs";

const finding = { code: "latin", en: "Example", ru: "example", message: "example" };
const result = (warning) => ({ counts: { error: 0, warning: warning.length, info: 0 }, issues: { error: [], warning, info: [] } });
const baseline = {
  schema: "paperclip-ru-lint-warning-baseline/v2",
  sourceCommit: "a".repeat(40),
  accepted: [{ id: findingId(finding), code: finding.code, en: finding.en, reason: "Test fixture" }],
};

test("an exact accepted diagnostic remains visible separately from active warnings", () => {
  const actual = applyLintBaseline(result([finding]), baseline);
  assert.equal(actual.counts.warning, 0);
  assert.equal(actual.counts.accepted, 1);
  assert.equal(actual.rawCounts.warning, 1);
  assert.equal(actual.issues.accepted[0].ru, finding.ru);
  assert.equal(actual.issues.accepted[0].reason, "Test fixture");
});

test("same-count replacements and changed translations cannot reuse an allowance", () => {
  for (const field of ["code", "en", "ru", "message"]) {
    const actual = applyLintBaseline(result([{ ...finding, [field]: "changed" }]), baseline);
    assert.equal(actual.counts.warning, 1, field);
    assert.equal(actual.counts.accepted, 0, field);
  }
});

test("baseline never removes errors or accepts malformed and duplicate records", () => {
  const input = result([]);
  input.issues.error.push({ code: "placeholder" });
  input.counts.error = 1;
  assert.equal(applyLintBaseline(input, baseline).counts.error, 1);
  for (const invalid of [
    {}, { ...baseline, sourceCommit: "" },
    { ...baseline, accepted: [...baseline.accepted, ...baseline.accepted] },
    { ...baseline, accepted: [{ ...baseline.accepted[0], reason: "" }] },
  ]) assert.throws(() => applyLintBaseline(input, invalid), /baseline/);
});

test("the published dictionary has no unaccepted diagnostics", () => {
  const current = JSON.parse(fs.readFileSync(new URL("../../data/lint-warning-baseline.json", import.meta.url), "utf8"));
  const actual = applyLintBaseline(lintDictionary(), current);
  assert.equal(actual.counts.error, 0);
  assert.deepEqual(actual.issues.warning, []);
  assert.equal(actual.counts.accepted, actual.rawCounts.warning);
});
