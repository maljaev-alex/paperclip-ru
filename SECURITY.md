# Security

paperclip-ru изменяет локально установленный frontend bundle Paperclip.
Запускайте инструмент только из доверенного релиза с проверенным SHA-256.

## Сообщить об уязвимости

Пишите на **maljaev@gmail.com**.

Дополнительный приватный канал: **GitHub Security Advisories** в репозитории
[maljaev-alex/paperclip-ru](https://github.com/maljaev-alex/paperclip-ru/security/advisories/new).

Не открывайте публичный issue с эксплойтом или секретами.

## Граница доверия

- Инструмент не читает базу Paperclip и не требует API key.
- `apply` / `status` / `revert` не отправляют содержимое установки в сеть и не
  содержат телеметрии.
- Запись проверяется на нахождение внутри выбранного `ui-dist`
  и `ui-dist/.paperclip-ru`.
- Runtime overlay не использует `eval` и не загружает удалённый код.
- Force-операции только явные: `--force-baseline`, `revert --force`.
