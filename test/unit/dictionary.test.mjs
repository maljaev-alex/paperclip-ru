import test from "node:test";
import assert from "node:assert/strict";
import { loadDictionary, EXACT_LAYER_ORDER, dictionaryFingerprint } from "../../tools/lib/dictionary.mjs";
import { createTranslator, plural } from "../../tools/lib/translate-runtime.mjs";

test("слой ru.json перекрывает bulk", () => {
  const dict = loadDictionary();
  assert.equal(EXACT_LAYER_ORDER.at(-1), "ru.json");
  assert.equal(dict.exact.get("Dashboard"), "Обзор");
  assert.equal(dict.exact.get("heartbeat"), "пробуждение");
});

test("September composite chrome preserves embedded entity names", () => {
  const { translate } = createTranslator(loadDictionary());
  assert.equal(translate('Message Settings…'), 'Напишите Settings…');
  assert.equal(translate('Message Settings — describe what you want done…'), 'Напишите Settings — опишите, что нужно сделать…');
  assert.equal(translate('Close Dashboard', 'attr'), 'Закрыть Dashboard');
  assert.equal(translate('Settings navigation', 'attr'), 'Settings — навигация');
  assert.equal(translate('Открыть план revision 3', 'attr'), 'Открыть редакцию плана 3');
});

test("описания вариантов «Лимит» в управлении взаимодействиями переведены", () => {
  const dict = loadDictionary();
  const notCreator = "Even a card that asks for Anyone is narrowed to exclude its creator.";
  const humanOnly = "Every card of this kind waits for a person, whatever it asked for.";
  assert.match(String(dict.exact.get(notCreator)), /[\u0400-\u04ff]/);
  assert.match(String(dict.exact.get(humanOnly)), /[\u0400-\u04ff]/);
});

test("ошибка недоступного для запуска агента переведена", () => {
  const dict = loadDictionary();
  assert.equal(
    dict.exact.get("Agent is not invokable in its current state"),
    "Агент недоступен для запуска в текущем состоянии",
  );
});

test("подсказка переменных регламента переведена без изменения placeholder", () => {
  const dict = loadDictionary();
  const before = dict.exact.get("Variables are auto-detected from ");
  const after = dict.exact.get(" in the title & instructions. The variable name is read-only — rename by editing the placeholder.");
  assert.equal(before, "Переменные автоматически определяются по шаблонам ");
  assert.equal(after, " в заголовке и инструкциях. Имя переменной доступно только для чтения — для переименования измените шаблон.");
  assert.equal(
    `${before}{{placeholders}}${after}`,
    "Переменные автоматически определяются по шаблонам {{placeholders}} в заголовке и инструкциях. Имя переменной доступно только для чтения — для переименования измените шаблон.",
  );
});

test("no-exact убирает Open из точного словаря", () => {
  const dict = loadDictionary();
  assert.equal(dict.exact.has("Open"), false);
  assert.equal(dict.exact.has("open"), false);
});

test("no-static содержит инструкцию CEO", () => {
  const dict = loadDictionary();
  const key = [...dict.noStatic].find((s) => s.startsWith("You are the CEO"));
  assert.ok(key);
});

test("fingerprint стабилен", () => {
  const a = loadDictionary();
  const b = loadDictionary();
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(dictionaryFingerprint(a), a.fingerprint);
});

test("recase и trim сохраняют пробелы", () => {
  const t = createTranslator({
    exact: { "Save": "Сохранить", " Open": " Открыть" },
    rules: [],
  });
  assert.equal(t.translate("Save"), "Сохранить");
  assert.equal(t.translate("save"), "Сохранить");
  assert.equal(t.translate("  Save  "), "  Сохранить  ");
});

test("scopes text/attr для Open", () => {
  const t = createTranslator({
    exact: {},
    rules: [
      { pattern: "^Open$", flags: "", replace: "Открыть", scope: "attr" },
      { pattern: "^Open$", flags: "", replace: "Открыто", scope: "text" },
    ],
  });
  assert.equal(t.translate("Open", "attr"), "Открыть");
  assert.equal(t.translate("Open", "text"), "Открыто");
});

test("рекурсивные {t} {tl} {r}", () => {
  const t = createTranslator({
    exact: { Open: "Открыто", "1h ago": "1 ч назад" },
    rules: [
      { pattern: "^changed status to (.+)$", flags: "", replace: "изменил статус на «{tl:1}»" },
      { pattern: "^Finished (.+)$", flags: "", replace: "Завершено {r:1}" },
    ],
  });
  assert.equal(t.translate("changed status to Open"), "изменил статус на «открыто»");
  assert.equal(t.translate("Finished 1h ago"), "Завершено 1 ч назад");
});

test("русские формы 0/1/2/4/5/11/14/21/22/25", () => {
  const samples = [
    [0, "файлов"],
    [1, "файл"],
    [2, "файла"],
    [4, "файла"],
    [5, "файлов"],
    [11, "файлов"],
    [14, "файлов"],
    [21, "файл"],
    [22, "файла"],
    [25, "файлов"],
    [101, "файл"],
    [111, "файлов"],
  ];
  for (const [n, form] of samples) {
    assert.equal(plural(n, "файл", "файла", "файлов"), form, String(n));
  }
});

test("динамические event keys", () => {
  const t = createTranslator({
    exact: { "agent status changed": "статус агента изменён" },
    rules: [],
  });
  assert.equal(t.translate("agent.status_changed"), "статус агента изменён");
});

test("регламент переводит фильтр, счётчик, статус и динамическое расписание", () => {
  const t = createTranslator(loadDictionary());
  assert.equal(t.translate("any"), "Любой");
  assert.equal(t.translate("any", "attr"), "any");
  assert.equal(t.translate("1 trigger"), "1 триггер");
  assert.equal(t.translate("2 triggers"), "2 триггера");
  assert.equal(t.translate("5 triggers"), "5 триггеров");
  assert.equal(t.translate("Execution failed"), "Ошибка выполнения");
  assert.equal(t.translate("failed"), "Ошибка");
  assert.equal(t.translate(" · failed"), " · ошибка");
  assert.equal(t.translate("05.09.2026, 17:26:30 · failed"), "05.09.2026, 17:26:30 · ошибка");
  assert.equal(t.translate("Last run failed. Open runs.", "attr"), "Последний запуск: Ошибка. Открыть запуски.");
  assert.equal(t.translate("Every Monday at 10:00"), "По понедельникам в 10:00");
  assert.equal(t.translate("Every Monday, Wednesday and Friday at 10:00"), "Каждую неделю: понедельник, среда и пятница — 10:00");
  assert.equal(t.translate("Every weekday at 09:15"), "По будням в 09:15");
  assert.equal(t.translate("Day 3 of every month at 08:30"), "3-го числа каждого месяца в 08:30");
  assert.equal(t.translate("Next: 07.09.2026, 10:00:00"), "Следующий запуск: 07.09.2026, 10:00:00");
  assert.equal(t.translate("cron"), "cron");
});
