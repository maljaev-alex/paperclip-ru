# Каталог `test/official`

Браузерные тесты настоящих npm-сборок `@paperclipai/server`. Запускаются через
`tools/official-gate.mjs` только с отдельной PostgreSQL-базой на localhost.

| Файл | Проверяет |
| --- | --- |
| `editor.test.mjs` | Нативное сохранение, dirty-state и байты редактора. |
| `panels.test.mjs` | Наличие opt-in hooks, реальный drag и восстановление ширины. |
| `routes.test.mjs` | Операторские маршруты, desktop/mobile и transient surfaces. |
| `user-content.test.mjs` | Сохранение пользовательских названий, совпадающих с ключами словаря. |

Положительный fixture-тест не заменяет этот контур при объявлении совместимости.
