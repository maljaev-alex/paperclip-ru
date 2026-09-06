# Каталог `test/e2e`

Playwright-проверки локального синтетического интерфейса. Они быстро ловят
регрессии overlay без установки полного Paperclip.

| Файл | Проверяет |
| --- | --- |
| `dictionary-boundaries.test.mjs` | Границы между UI-текстом, данными, кодом и инструкциями. |
| `editor-preservation.test.mjs` | Побайтовое сохранение содержимого редакторов и dirty-state. |
| `lifecycle.test.mjs` | Применение и снятие overlay в браузерном fixture. |
| `panel-native-state.test.mjs` | Состояние нативных панелей и отсутствие ложных hooks. |
| `panels.test.mjs` | Опциональный ресайз и сохранение ширины. |
| `route-matrix.test.mjs` | Маршруты, responsive layout и открываемые поверхности. |
| `user-content.test.mjs` | Неприкосновенность пользовательских названий и сообщений. |
