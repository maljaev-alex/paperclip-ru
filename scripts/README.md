# Каталог `scripts`

Тонкие bootstrap-обёртки для установки, обновления и удаления управляемой
копии `paperclip-ru`. Вся проверка и транзакционная логика остаётся в Node CLI.

| Файл | Назначение |
| --- | --- |
| `install.ps1` | Установка проверенного release на Windows PowerShell. |
| `install.sh` | Та же операция для Linux/macOS и Git Bash. |
| `update.ps1` | Транзакционное обновление инструмента на Windows. |
| `update.sh` | Транзакционное обновление на POSIX. |
| `uninstall.ps1` | Проверенный revert и удаление только файлов инструмента на Windows. |
| `uninstall.sh` | То же для POSIX. |

Скрипты не должны запрашивать ввод в non-interactive режиме, менять `PATH` или
удалять Paperclip и пользовательские данные.
