# paperclip-ru

[English README](README.en.md)

Неофициальный слой русской локализации для официальных npm-сборок
[Paperclip](https://github.com/paperclipai/paperclip) (`paperclipai`).
**Это не официальный продукт Paperclip и не форк исходников.**

Инструмент покрывает классифицированный операторский UI поддерживаемых версий;
технический и пользовательский контент сохраняется исходным.

## Для кого этот проект

- **Пользователям Paperclip** — чтобы включить русский интерфейс и при
  необходимости безопасно вернуться к исходному bundle.
- **Администраторам** — чтобы устанавливать и обновлять локализацию
  non-interactive командами с JSON-результатом и стабильными exit codes.
- **Переводчикам** — чтобы исправлять термины, добавлять новые строки и
  проверять контекст, не изменяя пользовательские данные.
- **Разработчикам** — чтобы воспроизводить lifecycle, браузерные тесты и
  совместимость на официальных npm-релизах Paperclip.

Ключевые свойства: fail-closed проверка версии и хешей, детерминированные
архивы, атомарные записи, durable journal, доказуемый rollback, побайтовый
`revert` и изолированная проверка каждой заявленной версии Paperclip.

## Что переводит и чего не переводит

Переводится: видимая операторская оболочка, заголовки, кнопки, подсказки,
placeholders, aria-текст, системные сообщения UI, названия событий в журнале,
даты/числа/относительное время, русские формы счётчиков.

Не переводится: инструкции и системные промпты агентов; содержимое `AGENTS.md`,
`SOUL.md`, `HEARTBEAT.md`, `TOOLS.md`; пользовательские задачи, комментарии,
документы и Markdown; исходный код, команды, пути, JSON/YAML/TOML;
идентификаторы, enum, API-маршруты, CSS-классы, storage keys; бренды и имена
моделей без утверждённого русского имени.

## Требования

| Компонент | Минимум |
| --- | --- |
| ОС | Windows и Linux; macOS — experimental |
| Node для **этого инструмента** | 20+ |
| Node для актуального Paperclip | 24.11+ (требование upstream, не этого репозитория) |
| Paperclip | Все проверенные stable за последние 30 дней; точный список — в матрице совместимости. Canary/nightly/commit не поддерживаются. |

Матрица: [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).

## Установка

### Из GitHub Release

1. Скачайте `paperclip-ru-<версия>.zip` или `.tar.gz`, `release-manifest.json` и `SHA256SUMS` из stable GitHub Release.
2. Проверьте checksum (см. ниже).
3. Распакуйте архив во временный bootstrap-каталог отдельно от конечной установки.
4. В распакованном `paperclip-ru/` выполните `npm ci --omit=dev` по lockfile.
5. Запустите `scripts/install.ps1 -Version 1.0.0 -SourceDir <distDir> -NonInteractive -Json` (POSIX: `scripts/install.sh --version 1.0.0 --source-dir <distDir> --non-interactive --json`). Скрипт проверит архив, установит инструмент в пользовательский каталог и выполнит doctor/dry-run/apply/verify. Полный сценарий и пути: [`AGENTS.md`](AGENTS.md).

Self-contained artifact в v1 не поставляется. До первой публикации используйте
локальный каталог готовых релизных архивов с `--source-dir`.

Не используйте `curl | sh` / `irm | iex`.

### Из исходников

```powershell
git clone https://github.com/maljaev-alex/paperclip-ru.git
cd paperclip-ru
npm ci
node tools/paperclip-ru.mjs doctor --json
node tools/paperclip-ru.mjs apply --dry-run --json
node tools/paperclip-ru.mjs apply --json
node tools/paperclip-ru.mjs verify --json
```

Исходный клон может применять и отключать перевод напрямую. Управляемые
`update` и `uninstall` требуют ownership marker, который создаёт `install`.

### Клон для разработки

GitHub Release содержит не только runtime CLI, но и полный разрешённый снимок
исходников: тесты, fixtures, инструменты перевода и упаковки, документацию и CI.
После распаковки contributor-архива или клонирования репозитория:

```powershell
npm ci
npm run build
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
```

Playwright устанавливается как dev dependency. Официальный browser gate требует
отдельную одноразовую PostgreSQL-базу и никогда не должен запускаться на рабочей
БД Paperclip. Подробности: [`CONTRIBUTING.md`](CONTRIBUTING.md) и
[`docs/TESTING.md`](docs/TESTING.md).

## Команды

| Команда | Назначение |
| --- | --- |
| `doctor [--json]` | Node, найденный Paperclip, версия, права, baseline, manifest, совместимость |
| `status [--json]` | Состояние перевода |
| `verify [--json]` | Хеши, overlay/index marker, словарь, postconditions |
| `apply [--dry-run] [--server-dir] [--with-panel-resize]` | Применить локализацию |
| `reapply` | Явный сценарий после обновления Paperclip |
| `revert [--dry-run]` | Вернуть исходные байты |
| `extract [--output]` | Кандидаты строк |
| `report [--output]` | status + coverage |
| `install [--release-version] [--source-dir]` | Проверить и установить релиз с ownership marker |
| `update [--release-version] [--source-dir]` | Обновить инструмент с автоматическим rollback |
| `uninstall [--install-dir]` | Проверить и удалить управляемую установку после revert |

`--server-dir` важнее `PAPERCLIP_SERVER_DIR` и autodiscovery.
`--with-panel-resize` включает **опциональный** модуль ширины панелей (на чистой
установке выключен). Повторные `apply` / `reapply` без флага сохраняют выбор из
манифеста. Для явного отключения используйте `--without-panel-resize`.

Коды возврата: 0 успех, 1 ошибка, 2 аргументы, 3 не найден Paperclip, 4 неподдерживаемая сборка, 5 конфликт хешей, 6 права.

После `apply` инструмент **не** перезапускает Paperclip. Обновите страницу с очисткой кэша (Ctrl+F5).

## Состояния установки

| Состояние | Значение | Обычное следующее действие |
| --- | --- | --- |
| `not_installed` | Управляемой установки нет. | `install` или запуск CLI из исходников. |
| `installed_not_applied` | Инструмент установлен, перевод отключён. | `apply`. |
| `applied/current` | Перевод соответствует текущему проверенному bundle. | Ничего; после обновления страницы UI готов. |
| `applied/stale` | Paperclip обновился после применения перевода. | `reapply --dry-run`, затем `reapply`. |
| `conflict` / `conflict/partial` | Хеши или journal не позволяют доказать безопасную запись. | Остановиться и выполнить диагностику. |
| `unsupported` | Для точного bundle нет подтверждённого fingerprint. | Обновить инструмент или добавить совместимость. |

`doctor`, `status`, `verify` и любой `--dry-run` read-only. При конфликте CLI
не пытается «угадать» оригинал и не удаляет baseline как способ исправления.

## Baseline

Оригиналы изменённых файлов хранятся в `ui-dist/.paperclip-ru/baseline/`.
Они нужны, чтобы `revert` вернул байты один в один и чтобы повторный `apply`
не считал уже переведённые файлы «чистой сборкой».

Обновление Paperclip **заменяет** patched files. Нужен `reapply`: старый
baseline не является оригиналом новой версии.

## Как устроен репозиторий

```text
paperclip-ru/
├── .github/                 # CI, release/compatibility workflows и шаблоны
├── data/                    # compatibility, fingerprints и release metadata
├── docs/
│   └── images/              # проверенные снимки демонстрационного интерфейса
├── locales/                 # словари, правила, plural и исключения
├── scripts/                 # bootstrap install/update/uninstall для PS и POSIX
├── test/
│   ├── e2e/                 # Playwright на синтетическом frontend
│   ├── fixtures/            # автономный мини-сервер и ui-dist
│   ├── helpers/             # общие тестовые функции
│   ├── integration/         # lifecycle, архивы, journal и fault injection
│   ├── official/            # browser gate официального Paperclip
│   └── unit/                # быстрые проверки модулей и контрактов
├── tools/
│   └── lib/                 # модули CLI, patch, rollback и release builder
├── AGENTS.md                # единственный операционный runbook агента
├── CONTRIBUTING.md          # правила участия в разработке
├── LICENSE                  # MIT
├── README.en.md             # краткая английская документация
├── README.md                # основная документация
├── SECURITY.md              # безопасное сообщение об уязвимостях
├── package.json             # команды и зависимости Node.js
└── package-lock.json        # воспроизводимые версии зависимостей
```

После сборки локально появляется `dist/` ровно с четырьмя публикуемыми файлами.
Каталог не версионируется и поэтому не включён в дерево исходников выше.

| Путь | Содержимое |
| --- | --- |
| [`data/`](data/README.md) | Совместимость, fingerprints, release config и lint baseline. |
| [`locales/`](locales/README.md) | Слои словаря, правила, plural и исключения. |
| [`tools/`](tools/README.md) | Пользовательский CLI и инструменты разработки. |
| [`tools/lib/`](tools/lib/README.md) | Модули lifecycle, overlay, архивов и безопасных файловых операций. |
| [`scripts/`](scripts/README.md) | PowerShell/Bash bootstrap-команды. |
| [`test/`](test/README.md) | Unit, integration, e2e, official и fixtures. |
| [`docs/`](docs/README.md) | Постоянная документация без временных отчётов. |
| `.github/` | CI, compatibility/release workflows и шаблоны GitHub; служебный каталог. |
| `dist/` | Только четыре генерируемых release-файла; в Git не отслеживается. |

Каждый версионируемый каталог, кроме служебных каталогов с точкой, содержит
свой `README.md`. Наличие этих файлов проверяется unit-тестом. `node_modules/`,
`work/`, `dist/` и `test-results/` являются генерируемыми и не входят в tracked
source tree.

## Изменение перевода

1. Определите, является ли строка оболочкой UI, пользовательским содержимым,
   инструкцией агента, кодом или идентификатором.
2. Для точечной правки используйте `locales/ru.json`; не редактируйте большой
   `ru.bulk.json` без необходимости.
3. Для новой волны извлеките строки инструментами из `tools/`, работайте во
   временных `work/` и `locales/parts/`, затем сохраните только итоговые слои.
4. Проверьте glossary, placeholders, `no-exact`, `no-static` и scoped rules.
5. Запустите build, lint и тесты. Для новой версии Paperclip выполните
   официальный lifecycle/browser gate в обоих режимах.

Полный процесс и происхождение слоёв:
[`docs/TRANSLATION-GUIDE.md`](docs/TRANSLATION-GUIDE.md), термины:
[`docs/GLOSSARY.md`](docs/GLOSSARY.md).

## Уровни тестирования

| Уровень | Что доказывает |
| --- | --- |
| Unit | Контракты аргументов, словарей, fingerprints, архивов и атомарных операций. |
| Integration | Apply/revert, install/update/uninstall, journal, failpoints и final bytes. |
| E2E fixture | Поведение overlay, редакторов, пользовательского текста, маршрутов и панелей. |
| Official | То же на точной npm-сборке Paperclip и отдельной БД. |
| Compatibility | Полный lifecycle всех stable-релизов в заявленном временном окне. |

Зелёный synthetic fixture не является доказательством совместимости с
официальной сборкой. Финальный release принимается только после установки
непосредственно из собранных ZIP и TAR.GZ и побайтового revert.

## Checksum релизного архива

```powershell
Get-FileHash .\paperclip-ru-1.0.0.zip -Algorithm SHA256
# сравните с строкой в SHA256SUMS
```

```bash
grep " paperclip-ru-1.0.0.tar.gz$" SHA256SUMS | sha256sum -c -
```

## Как сообщить о новой английской строке

Откройте issue по шаблону Translation. Укажите версию Paperclip, маршрут,
точный английский текст и скриншот **без** персональных данных.

Для исправления кода создайте отдельную ветку, не добавляйте generated output,
приложите команды проверки и укажите, затрагивается ли runtime, lifecycle,
словарь или только документация. Правила участия находятся в
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Known limitations

- Зависит от внутренней структуры minified bundle Paperclip. Смена имён chunks
  или AST-сигнатур приводит к контролируемому отказу, а не к частичному патчу.
- Текст в редакторах, пользовательские заголовки и названия сохраняются; оболочка редактора переводится.
- `/design-guide` — служебный каталог компонентов upstream, исключён из операторской матрицы.
- Coverage нельзя оценивать по размеру `work/missing.json` (шум библиотек).
- Изменение ширины панелей — отдельная opt-in функция.
- Paperclip 2026.817.0 поддерживается в режиме best-effort: его исходный frontend
  обращается к отсутствующему endpoint `built-in-agents`; подробности — в матрице.

## Скриншоты

Реальный локальный демонстрационный стенд Paperclip с применённым русским
overlay и тёмной темой. Снимки сделаны без интерфейса браузера и системных окон.

### Обзор

![Обзор](docs/images/dashboard.jpg)

| Задачи | Агенты |
| --- | --- |
| ![Задачи](docs/images/issues.jpg) | ![Агенты](docs/images/agents.jpg) |

| Проекты | Затраты |
| --- | --- |
| ![Проекты](docs/images/projects.jpg) | ![Затраты](docs/images/costs.jpg) |

| Журнал | Навыки |
| --- | --- |
| ![Журнал](docs/images/activity.jpg) | ![Навыки](docs/images/skills.jpg) |

## Репозиторий и распространение

Исходники: [maljaev-alex/paperclip-ru](https://github.com/maljaev-alex/paperclip-ru).
Уязвимости: [`SECURITY.md`](SECURITY.md).

Пакет **не публикуется в npm** (`private: true`). Канал распространения —
GitHub Release: zip/tar.gz + `SHA256SUMS`.

Оба архива имеют одинаковый корень `paperclip-ru/` и содержат полный
разрешённый tracked snapshot для использования и разработки. В них не попадают
зависимости, `work/`, `locales/parts/`, предыдущие сборки, отчёты ревью,
локальные handoff-файлы и секреты. `release-manifest.json` снаружи архива
связывает commit, payload manifest и SHA-256 обоих форматов.

## Лицензия

MIT. См. [`LICENSE`](LICENSE).
