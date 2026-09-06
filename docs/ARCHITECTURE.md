# Architecture

Модель v1: **patcher + runtime overlay** поверх официального `@paperclipai/server`.
Не форк Paperclip. Русский — единственная локаль v1.

## Слои

1. **Discovery** (`tools/lib/paths.mjs`) — `--server-dir` > env > npm global candidates. Prefix берётся из env/npmrc и расположения Node без запуска npm; diagnostics не создают и не чистят npm cache/logs.
2. **Dictionary** (`tools/lib/dictionary.mjs`) — exact: `ru.bulk.json` → `ru.catalog.json` → `ru.manual.json` → `ru.json`; затем `no-exact.json`; fallback `ru.rules.json`; счётчики `ru.plurals.json`. `ru.json` — ручные overrides, источник истины для формулировок.
3. **AST patch** (`tools/lib/strings.mjs`) — только display-safe позиции. Блокируются object keys, comparisons, switch, selectors, storage keys, semantic keys, import, tagged templates, `systemPrompt`.
4. **Runtime overlay** (`tools/lib/overlay.mjs`) — DOM setters после attach; `createTextNode` не перехватывается. Редакторы (textarea, contenteditable, Lexical, MDX, CodeMirror, Monaco, Shiki, Prism) пропускаются, кроме placeholder-chrome композера задачи.
5. **Manifest / baseline / rollback** (`tools/lib/apply.mjs`, `manifest.mjs`, `journal.mjs`) — schema `paperclip-ru-manifest/v3`, durable journal и recovery snapshots до первой mutation, post-commit verify, fail-closed revert.
6. **Optional UI** (`tools/lib/panels.mjs`) — resize панелей, выключен на чистой установке; повторное применение сохраняет выбор из манифеста. Ошибка модуля не ломает перевод.

## Provenance переводов

| Файл | Роль |
| --- | --- |
| `locales/ru.json` | ручные overrides, высший приоритет |
| `locales/ru.bulk.json` | собранный основной словарь (коммитится; детерминированная сортировка ключей, `merge-parts --check`) |
| `locales/parts/` | локальная временная область новой волны; не коммитится и не публикуется |
| `locales/no-exact.json` | снять точное совпадение ради scoped rules |
| `locales/no-static.json` | не патчить JS-значение (модель/данные); оверлей может показать перевод |

`work/` воспроизводим и не входит в Git/release artifact. Постоянный provenance
хранится в итоговых словарях, glossary и `docs/TRANSLATION-GUIDE.md`, а не в
старых chunks или отчётах ревью.

## Жизненный цикл релиза

`lifecycle.mjs` проверяет checksum и detached manifest до распаковки, затем
embedded manifest и весь payload до выполнения CLI. Портативный parser отвергает traversal, дубликаты, ссылки и
повреждённые CRC/USTAR/XML. Runtime dependencies устанавливаются по lockfile
с выключенными lifecycle scripts. Новый CLI выполняется из staging и затем
из установленного каталога; исходное дерево проекта не служит fallback.

`lifecycle-transaction.mjs` хранит журнал v2 в os.tmpdir() и полные снимки
инструмента/ui-dist. До rollback проверяются все snapshot hashes и отсутствие
посторонних live-файлов. Восстанавливаются bytes, files/directories, mode и mtime.
Дочерний apply/revert имеет собственный journal v1; оба уровня восстанавливаются
последовательно. Terminal journal удаляется после остальных recovery-файлов.

UI journal сохраняет POSIX modes исходных файлов и каталогов. Восстановление
проверяет их вместе с hashes и временем файлов; сторонний `chmod` блокирует
recovery. Старый незавершённый journal без доказанных modes на POSIX требует
ручного разбора и сохраняется. Recovery/staging-копии создаются с mode `0600`.
При недоказанном rollback JSON сообщает `changed=true`, `conflict/partial` и
`nextAction=force_manual`; успешный rollback возвращает фактическое исходное
состояние, включая `applied/stale`.

В Windows имя lifecycle-журнала не зависит от регистра пути. Сохраняется поиск
журналов предыдущего RC; несколько журналов для одного каталога блокируют запись.
Новые журналы имеют отдельный префикс имени, чтобы legacy discovery не открывал
журналы других активных новых транзакций. Атомарное переименование при временной
Windows sharing violation повторяется не более 500 мс; постоянный отказ в правах
по-прежнему завершает операцию с ошибкой и сохранением recovery evidence.

Dirty compare модифицирует только известное выражение в bundle. Начальная
сериализация списков/CRLF допускается до первого input; после него сравнение
точное. Значения инструкций не переписываются, window.confirm не перехватывается.
