# Releasing

Канал распространения — GitHub Releases репозитория `maljaev-alex/paperclip-ru`.
`package.json` остаётся `private: true`; npm publish не используется.
До отдельного разрешения владельца подготовка ограничена локальной веткой,
коммитами, проверками и архивами. Push, tag и GitHub Release не создаются.

## Сборка кандидата

1. Выполнить `docs/TESTING.md`, включая официальный сервер и bootstrap на Windows
   PowerShell 5.1/7 и POSIX. Исправить ошибки; временные журналы проверки хранить
   вне публикуемого дерева и не добавлять в release.
2. Сверить версии в package.json, lockfile, constants и compatibility.
   Подготовить GitHub Release notes и проверить содержимое Git на секреты и
   персональные данные.
3. Закоммитить рассмотренный исходный код. Рабочее дерево должно быть чистым.
4. Запустить `npm run pack:check`. Артефакты появятся в игнорируемом `dist/`.
5. Проверить именно эти файлы: `PAPERCLIP_RU_DIST_DIR=<dist>` для integration и
   `test:official:isolated`. После тестов снова проверить SHA256SUMS.
6. Повторить сборку из чистого clone того же коммита и сравнить SHA-256 всех assets.
7. Сверить итоговые hashes; отдельный отчёт в release и репозиторий не добавлять.

Состав `dist/`:

- `paperclip-ru-1.0.0.zip` и `paperclip-ru-1.0.0.tar.gz`: одинаковый корень
  `paperclip-ru/` и полный разрешённый tracked snapshot: runtime, словари,
  bootstrap, инструменты разработки, тесты, fixtures, документация, CI и lockfile;
- `release-manifest.json`: commit, версия, политика совместимости, payload и hashes;
- `SHA256SUMS`: оба contributor-архива и detached manifest.

Это полный allowlist публикации. GitHub автоматически показывает исходники тега;
отдельный source-архив, отчёты проверки, прежние версии и промежуточные файлы в
Release не загружаются. Сборщик отказывается работать, если в каталоге назначения
есть что-либо кроме этих четырёх файлов текущей версии.

Внутри contributor-архива — `artifact-manifest.json`, а не detached manifest.
Обычная установка зависимостей выполняется через `npm ci --omit=dev`; для
разработки используется полный `npm ci`. Архивы не self-contained.
Генераторы, тесты, fixtures и постоянная документация входят. Переводческие
chunks, отчёты, `work/`, переписка, `node_modules`, предыдущие сборки и рабочие
baseline не входят.

Сборка нормализует текст в LF, порядок файлов и executable mode shell-скриптов.
Время в manifest берётся из Git commit либо явного SOURCE_DATE_EPOCH; заголовки
архивов нормализованы, включая признак ОС gzip. Внешний outDir не
отключает проверку чистоты. `testBuild=true` допустим только для fixture-тестов
во внешнем temp и явно отмечается в manifest.

## Публикация владельцем

`release.yml` запускается по тегу `v<package.version>` или вручную для проверки.
Несовпадение тега и версии блокирует сборку. Workflow проверяет unit, integration
на окончательных архивах, fixture e2e, настоящий Paperclip с отдельной БД, SVG,
секреты и checksums. Затем он прогоняет все stable-сборки из 30-дневного окна в
двух режимах панелей. После успеха загружает те же файлы в **draft** GitHub Release.
Ручной `workflow_dispatch` по умолчанию работает как dry-run; публикация draft
вручную возможна только при запуске на теге с `dry_run=false`.
Аттестации/SBOM в v1 не заявляются.

Перед открытием draft убедитесь, что GitHub private vulnerability reporting
включён, README-ссылки и release notes корректны. Установочные скрипты выбирают
только stable release из config; до первой публикации используется `--source-dir`.

Публичная ветка должна состоять из одного корневого коммита с окончательным
деревом: так удалённые отчёты, промежуточные словари и история подготовки не
попадут даже в Git history. В подготовленном к публикации репозитории не должны
оставаться старые локальные ветки, теги или reflog предыдущих состояний.

После отдельного решения владельца о публикации:

```powershell
git switch codex/public-v1-clean
git status --short
git rev-list --count HEAD # должно быть 1
npm run release:dry-run
# При успешных проверках и чистом дереве:
git push -u origin codex/public-v1-clean:main
git tag -a v1.0.0 -m "paperclip-ru 1.0.0"
git push origin v1.0.0
```

Команды публикации здесь приведены для владельца; агент их не выполнял.
По тегу CI заново проверит и соберёт release assets, затем создаст draft.
Открыть draft для пользователей следует после просмотра результатов workflow.
