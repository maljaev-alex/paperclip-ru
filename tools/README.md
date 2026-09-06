# Каталог `tools`

Исполняемые Node.js-команды проекта. Пользовательский entry point —
`paperclip-ru.mjs`; остальные файлы предназначены для разработки, проверки и
подготовки релиза и поэтому также включаются в contributor-архив.

| Файл | Назначение |
| --- | --- |
| `paperclip-ru.mjs` | Публичный CLI: doctor/status/verify/apply/reapply/revert/install/update/uninstall/extract/report. |
| `extract-installed-md.mjs` | Извлечение Markdown-контекста из установленного frontend. |
| `extract-server-data.mjs` | Сбор строк и данных из npm-пакета сервера. |
| `extract-source.mjs` | Извлечение кандидатов строк из исходников Paperclip. |
| `prepare-translation.mjs` | Подготовка временных work/chunks для новой волны перевода. |
| `merge-parts.mjs` | Проверка/нормализация `ru.bulk.json` и слияние временных частей. |
| `lint-dictionary.mjs` | Контекстный lint словарей и контроль warning baseline. |
| `generate-route-matrix.mjs` | Браузерный обход операторских маршрутов и поверхностей. |
| `official-gate.mjs` | Изолированный lifecycle и браузерный gate официального npm-релиза. |
| `recent-stables.mjs` | Получение и проверка stable-версий за заданное окно. |
| `pack-release.mjs` | Детерминированная сборка ZIP/TAR, manifest и SHA256SUMS. |
| `run-node-tests.mjs` | Кроссплатформенный запуск glob-наборов Node tests. |
| `routes.json` | Seed маршрутов для маршрутной матрицы. |
| `lib/` | Повторно используемые модули CLI и инструментов. |

Команды разработки описаны в [`../docs/TESTING.md`](../docs/TESTING.md) и
[`../docs/RELEASING.md`](../docs/RELEASING.md).
