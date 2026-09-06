import fs from "node:fs";
import path from "node:path";
import { loadDictionary, LOCALES_DIR } from "./dictionary.mjs";
import { readJson } from "./fs-atomic.mjs";

const PLACEHOLDER_RE =
  /(\{\{[^}]+\}\}|\{plural:[^}]+\}|\{t:\d\}|\{tl:\d\}|\{r:\d\}|\$\{\w+\}|\$\d|\{count\}|\{[a-zA-Z_][\w]*\}|%\d*\$?[sd]|\{[0-9]+\})/g;

const MODEL_CONTENT = /^(You are the |You are agent |You MUST |You will |You should )/m;

const GLOSSARY = [
  [/\bheartbeats?\b/i, /пробужден|будить|разбуд|запуск/i, "heartbeat→пробуждение"],
  [/\brouti(ne|nes)\b/i, /регламент/i, "routine→регламент"],
  [/\bskills?\b/i, /навык/i, "skill→навык"],
  [/\bagents?\b/i, /агент/i, "agent→агент"],
  [/\bapprovals?\b/i, /согласован|одобр/i, "approval→согласование"],
  [/\bartifacts?\b/i, /материал/i, "artifact→материал"],
  [/\bworkspaces?\b/i, /рабоч|сред/i, "workspace→рабочая область/среда"],
  [/\bresolv(e|ed|ing|er)?\b/i, /заверш|закры|сверк|урегулир/i, "resolve→завершить/закрыть"],
  [/\breconcil(e|ed|ing|iation)?\b/i, /сверк|синхрон|соответств/i, "reconcile→сверка"],
  [/\bfallbacks?\b/i, /резервн|запасн|fallback/i, "fallback→резервный вариант"],
  [/\bliveness\b/i, /активност/i, "liveness→активность"],
  [/\bworker process\b/i, /воркер/i, "worker process→процесс-воркер"],
  [/\bactivity gate\b/i, /проверк/i, "activity gate→проверка активности"],
  [/\binline comments?\b/i, /внутри строк|внутристрочн/i, "inline comments→комментарии внутри строк"],
  [/\bmodel lane\b/i, /канал/i, "model lane→канал модели"],
];

const PROPER_NOUNS =
  /(SKILL\.md|AGENTS\.md|SOUL\.md|HEARTBEAT\.md|Agent Skills|Agent Company|AWS Secrets Manager|Secrets Manager|skills\.sh|Agent Alpha|agent-acp|claude-agent|Skill Studio|Summarizer)/g;

function placeholders(s) {
  return (String(s).match(PLACEHOLDER_RE) || []).sort();
}

function latinTokens(ru) {
  return ru.match(/[A-Za-z][A-Za-z0-9.+_-]{1,}/g) || [];
}

export function lintDictionary({ checkUnused = false } = {}) {
  const dict = loadDictionary();
  const allowlist = readJson(path.join(LOCALES_DIR, "latin-allowlist.json"), []);
  const allow = new Set(allowlist.map((a) => String(a.term)));
  const issues = {
    error: [],
    warning: [],
    info: [],
  };

  for (const [en, ru] of dict.exact) {
    if (!ru.trim()) {
      issues.error.push({ code: "empty", en, ru, message: "пустой перевод" });
      continue;
    }

    const lead = (s) => s.match(/^\s*/)[0];
    const tail = (s) => s.match(/\s*$/)[0];
    if (lead(en) !== lead(ru) || tail(en) !== tail(ru)) {
      issues.error.push({ code: "whitespace", en, ru, message: "не совпадают краевые пробелы" });
    }

    const enPh = placeholders(en).join("|");
    const ruPh = placeholders(ru).join("|");
    if (enPh !== ruPh) {
      issues.error.push({ code: "placeholder", en, ru, message: `плейсхолдеры: ${enPh} -> ${ruPh}` });
    }

    if (/[?]/.test(en.trim()) && !/[?]/.test(ru.trim()) && !/[?]/.test(ru)) {
      issues.error.push({ code: "punct", en, ru, message: "потерян вопросительный знак" });
    }

    if (MODEL_CONTENT.test(en) && !dict.noStatic.has(en)) {
      issues.error.push({
        code: "model-content",
        en,
        ru,
        message: "похоже на инструкцию модели и нет в no-static.json",
      });
    }

    const tokens = latinTokens(ru);
    const unexplained = [];
    const explained = [];
    for (const tok of tokens) {
      if (allow.has(tok) || allow.has(tok.toUpperCase()) || allow.has(tok.toLowerCase())) explained.push(tok);
      else unexplained.push(tok);
    }
    if (unexplained.length) {
      issues.warning.push({
        code: "latin",
        en,
        ru,
        message: unexplained.slice(0, 6).join(", "),
      });
    } else if (explained.length) {
      issues.info.push({ code: "latin-allowed", en, ru, message: explained.slice(0, 4).join(",") });
    }

    const enTerms = en.replace(PROPER_NOUNS, " ");
    for (const [src, expect, label] of GLOSSARY) {
      src.lastIndex = 0;
      expect.lastIndex = 0;
      if (src.test(enTerms) && !expect.test(ru)) {
        issues.warning.push({ code: "glossary", en, ru, message: label });
      }
    }

    if (/\s{2,}/.test(ru) || /\bВы\b/.test(ru)) {
      issues.warning.push({ code: "suspicious", en, ru, message: "двойной пробел или «Вы»" });
    }

    const words = en.trim().split(/\s+/);
    if (words.length === 1 && en.trim().length <= 8 && /^[A-Za-z]+$/.test(en.trim()) && !dict.noExact.includes?.(en)) {
      const short = en.trim();
      if (!["Save", "Cancel", "Delete", "Close", "Search", "Filter"].includes(short)) {
        issues.warning.push({
          code: "short-key",
          en,
          ru,
          message: "короткий омонимичный ключ: проверьте no-exact или scoped-rule",
        });
      }
    }
  }

  const seenPattern = new Map();
  dict.rules.forEach((r, i) => {
    let re;
    try {
      re = new RegExp(r.pattern, r.flags || "");
    } catch (err) {
      issues.error.push({ code: "regex", en: r.pattern, ru: r.replace, message: `не компилируется: ${err.message}` });
      return;
    }
    if (re.test("") && r.pattern !== "^$") {
      issues.warning.push({ code: "regex-empty", en: r.pattern, ru: r.replace, message: "правило совпадает с пустой строкой" });
    }
    const key = `${r.scope || "any"}::${r.pattern}::${r.flags || ""}`;
    if (seenPattern.has(key)) {
      issues.warning.push({
        code: "regex-dup",
        en: r.pattern,
        ru: r.replace,
        message: `дубликат правила (индексы ${seenPattern.get(key)} и ${i})`,
      });
    } else {
      seenPattern.set(key, i);
    }
    const enPh = placeholders(r.replace.replace(/\{plural:[^}]+\}/g, "")).join("|");
    void enPh;
  });

  for (const en of dict.noStatic) {
    if (typeof en !== "string") continue;
  }

  if (checkUnused) {
    issues.warning.push({ code: "unused", en: "", ru: "", message: "проверка unused требует --check-unused и бандл" });
  }

  const required = readJson(path.join(LOCALES_DIR, "operator-required.json"), []);
  for (const item of required) {
    const en = typeof item === "string" ? item : item.en;
    if (!en) continue;
    if (!dict.exact.has(en)) {
      issues.error.push({
        code: "operator-required",
        en,
        ru: "",
        message: item.reason || "операторская строка из ревью не переведена",
      });
    }
  }

  const counts = {
    error: issues.error.length,
    warning: issues.warning.length,
    info: issues.info.length,
    entries: dict.exact.size,
    rules: dict.rules.length,
  };

  return { issues, counts, fingerprint: dict.fingerprint };
}

export function applySafeFixes() {
  const bulkFile = path.join(LOCALES_DIR, "ru.bulk.json");
  const bulk = JSON.parse(fs.readFileSync(bulkFile, "utf8"));
  let fixed = 0;
  for (const [en, ru] of Object.entries(bulk)) {
    if (typeof ru !== "string") continue;
    const lead = en.match(/^\s*/)[0];
    const tail = en.match(/\s*$/)[0];
    let next = ru;
    if (next.match(/^\s*/)[0] !== lead || next.match(/\s*$/)[0] !== tail) {
      next = lead + next.trim() + tail;
    }
    const enEnd = en.trim().match(/\.\.\.$|[.!?…:]$/)?.[0] ?? "";
    const ruEnd = next.trim().match(/\.\.\.$|[.!?…:]$/)?.[0] ?? "";
    if (enEnd && !ruEnd) {
      next = lead + next.trim() + enEnd + tail;
    }
    if (next !== ru) {
      bulk[en] = next;
      fixed += 1;
    }
  }
  const sorted = Object.fromEntries(Object.entries(bulk).sort((a, b) => a[0].localeCompare(b[0])));
  fs.writeFileSync(bulkFile, `${JSON.stringify(sorted, null, 2)}\n`);
  return fixed;
}
