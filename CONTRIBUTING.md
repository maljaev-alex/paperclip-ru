# Участие в разработке paperclip-ru

Спасибо за исправления перевода, тестов, документации и lifecycle. Проект
меняет локально установленный frontend bundle Paperclip, поэтому требования к
безопасности выше, чем у обычного словаря строк.

## Подготовка окружения

Требуются Git и Node.js 20+. Для browser/e2e-тестов используется Playwright.

```powershell
git clone https://github.com/maljaev-alex/paperclip-ru.git
cd paperclip-ru
npm ci
npm run build
npm run test:unit
```

Тот же набор файлов находится внутри ZIP/TAR GitHub Release: release является
contributor-ready snapshot, а не сокращённым runtime-пакетом.

## Где вносить изменения

| Задача | Основное место |
| --- | --- |
| Точечное исправление перевода | `locales/ru.json` |
| Курируемый общий термин | `locales/ru.catalog.json` и `docs/GLOSSARY.md` |
| Контекстная фраза или plural | `locales/ru.rules.json`, `locales/ru.plurals.json` |
| Защита пользовательского текста/кода | `no-exact.json`, `no-static.json`, `tools/lib/strings.mjs` |
| Lifecycle, rollback, manifest | `tools/lib/apply.mjs`, `journal.mjs`, `lifecycle*.mjs` |
| Установка и shell-обёртки | `tools/lib/lifecycle.mjs`, `scripts/` |
| Совместимость Paperclip | `data/compatibility.json`, `data/fingerprints.json` |
| Документация | `README.md`, `docs/` и README соответствующего каталога |

Прочитайте [`docs/TRANSLATION-GUIDE.md`](docs/TRANSLATION-GUIDE.md),
[`docs/GLOSSARY.md`](docs/GLOSSARY.md) и README каталога, который меняете.

## Правила перевода

1. Переводите операторскую оболочку, а не пользовательские данные.
2. Не переводите инструкции/промпты агентов, код, команды, пути, identifiers,
   enum, API routes, CSS classes и storage keys.
3. Сохраняйте placeholders, пробелы по краям и структуру форматирования.
4. Не редактируйте собранный `ru.bulk.json` вслепую. Для обычной корректировки
   используйте приоритетный `ru.json`.
5. Проверяйте короткие ключи (`Open`, `Active`, `Title` и подобные) в реальном
   контексте; exact-перевод может изменить пользовательское имя.
6. Новые исключения lint/coverage должны иметь конкретное объяснение.

`work/` и `locales/parts/` разрешены как временная рабочая область, но не
коммитятся. После слияния остаются только итоговые словари и постоянная
документация.

## Требования к коду

- Read-only команды и `--dry-run` не должны создавать файлы, каталоги или
  сетевые запросы.
- Любая запись должна быть атомарной, журналируемой и иметь доказуемый rollback.
- При неизвестном fingerprint, hash conflict или неполном journal операция
  завершается fail-closed без частичного патча.
- JSON-режим печатает в stdout ровно один JSON-документ; diagnostics идут в
  stderr.
- Не добавляйте автоматический restart Paperclip, изменение `PATH`,
  `curl | sh` или `irm | iex`.
- Не ослабляйте защиту install root, archive traversal и symlink escape.

## Какие проверки запускать

Минимум перед каждым pull request:

```powershell
npm ci
npm run build
npm run lint
npm run test:unit
```

Дополнительно по типу изменения:

| Изменение | Обязательные проверки |
| --- | --- |
| Словари/правила | Unit + e2e + lint |
| Overlay/панели/AST | Unit + integration + e2e |
| Lifecycle/архивы/scripts | Unit + полный integration + final-byte ZIP/TAR на Linux |
| Совместимость | Official gate в обычном режиме и с panel-resize, затем byte-identical revert |
| Release builder/CI | `npm run release:dry-run`, actionlint и установка из финальных архивов |
| Только Markdown | Проверка относительных ссылок и repository-layout unit test |

Полная матрица: [`docs/TESTING.md`](docs/TESTING.md). Официальные тесты требуют
одноразовую PostgreSQL-базу на localhost. Не используйте рабочую БД или рабочий
`ui-dist` для fault injection.

## Что не включать в commit и release

- `node_modules/`, `dist/`, `work/`, `test-results/`, Playwright reports;
- `locales/parts/` после завершения волны;
- отчёты аудита, временные specs/review, handoff и экспорты разговоров;
- baseline или recovery-копии реальной установки Paperclip;
- `.env`, credentials, ключи, токены, локальные абсолютные пути;
- реальные скриншоты с пользовательскими данными.

README обязателен в каждом новом versioned-каталоге, кроме служебного каталога,
имя которого начинается с точки.

## Pull request

В описании укажите:

1. Что меняется и почему.
2. Какие файлы runtime затронуты.
3. Точную версию Paperclip, если изменение version-specific.
4. Выполненные команды и результат тестов.
5. Требуется ли обновить compatibility/fingerprint/release manifest.

Используйте шаблоны `.github/ISSUE_TEMPLATE` и pull request template.
Уязвимости не публикуйте в обычном issue — следуйте [`SECURITY.md`](SECURITY.md).

## Для агентов

Корневой [`AGENTS.md`](AGENTS.md) — единственный канонический runbook. Не
создавайте `AGENT.md` или второй набор инструкций.
