# Каталог `tools/lib`

Внутренние ESM-модули CLI. Публичная совместимость гарантируется командами
`tools/paperclip-ru.mjs`, а не прямым импортом этих файлов.

| Файл | Ответственность |
| --- | --- |
| `apply.mjs` | Планирование патча, apply/revert, status/doctor/verify и postconditions. |
| `archive-read.mjs` | Валидация и безопасное извлечение ZIP/TAR.GZ. |
| `args.mjs` | Разбор аргументов, допустимые flags и справка CLI. |
| `classify.mjs` | Классификация состояния установки и orphan artifacts. |
| `cli.mjs` | Диспетчер публичных команд и единый JSON-ответ. |
| `compatibility.mjs` | Чтение и проверка матрицы совместимости. |
| `constants.mjs` | Версия инструмента, exit codes, states и общие константы. |
| `coverage.mjs` | Оценка покрытия операторских строк. |
| `dictionary.mjs` | Загрузка словарей, пути проекта и fingerprint словаря. |
| `failpoints.mjs` | Контролируемые точки отказа для тестов rollback. |
| `fingerprints.mjs` | Хеширование `ui-dist` и поиск официального fingerprint. |
| `fs-atomic.mjs` | SHA-256 и атомарные файловые операции. |
| `journal.mjs` | Журнал транзакции патча внутри `ui-dist`. |
| `json-result.mjs` | Стабильная схема машинного результата. |
| `lifecycle-transaction.mjs` | Durable transaction установки/обновления/удаления инструмента. |
| `lifecycle.mjs` | Загрузка release, staging, ownership и orchestration lifecycle. |
| `lint.mjs` | Правила контекстного lint словарей. |
| `manifest.mjs` | Чтение и строгая валидация manifest/baseline. |
| `official-gate-cleanup.mjs` | Очистка тестовой official-сборки без потери исходной ошибки; обязательный revert изменённых файлов. |
| `overlay.mjs` | Генерация браузерного слоя перевода. |
| `panels.mjs` | Опциональный модуль изменения ширины панелей. |
| `paths.mjs` | Безопасное обнаружение установленного Paperclip. |
| `release-builder.mjs` | Сборка contributor-архива из точного tracked snapshot. |
| `release-config.mjs` | Чтение настроек канала GitHub Release. |
| `safe-install-path.mjs` | Защита install root и ownership marker. |
| `secret-scan.mjs` | Проверка release tree на секреты и локальные пути. |
| `strings.mjs` | AST-анализ и классификация JavaScript-строк. |
| `svg-accept.mjs` | Строгая проверка SVG/XML и UTF-8. |
| `translate-runtime.mjs` | Общая runtime-логика перевода для инструментов разработки. |
| `tree-snapshot.mjs` | Инвентаризация дерева и побайтовое сравнение. |
| `zip-write.mjs` | Детерминированная запись ZIP и TAR.GZ. |

Изменение lifecycle-модулей требует unit, integration, fault-injection и
final-byte проверок обоих форматов архива.
