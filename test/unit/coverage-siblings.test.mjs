import test from "node:test";
import assert from "node:assert/strict";
import { analyzePartialSiblingGroups } from "../../tools/lib/coverage.mjs";

function dict(entries) {
  return { exact: new Map(Object.entries(entries)), rules: [] };
}

test("частично переведённая sibling-группа с операторским предложением — пробел", () => {
  const records = [
    { propKey: "emptyMessage", value: "No runs yet." },
    { propKey: "emptyMessage", value: "Nothing to show here." },
    { propKey: "emptyMessage", value: "Waiting to start..." },
  ];
  const groups = analyzePartialSiblingGroups(records, dict({
    "No runs yet.": "Запусков пока нет.",
    "Nothing to show here.": "Показывать нечего.",
  }));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].propKey, "emptyMessage");
  assert.deepEqual(groups[0].missing, ["Waiting to start..."]);
});

test("исключённый propKey и css-токен не считаются пробелом", () => {
  const records = [
    { propKey: "name", value: "Rectangle is a mermaid shape name here." },
    { propKey: "name", value: "Cylinder is another mermaid shape name." },
    { propKey: "name", value: "This mermaid name is untranslated on purpose." },
    { propKey: "warning", value: "Something went wrong on save." },
    { propKey: "warning", value: "Please try again later now." },
    { propKey: "warning", value: "text-(--status-task-icon-todo)" },
  ];
  const groups = analyzePartialSiblingGroups(records, dict({
    "Something went wrong on save.": "Не удалось сохранить.",
    "Please try again later now.": "Повторите попытку позже.",
  }), [
    { propKey: "name", category: "mermaid-shape" },
    { key: "text-(--status-task-icon-todo)", category: "css-token" },
  ]);
  assert.equal(groups.length, 0);
});
