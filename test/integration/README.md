# Каталог `test/integration`

Интеграционные проверки файловой системы, архивов и полного lifecycle.

| Файл | Проверяет |
| --- | --- |
| `apply-fixture.test.mjs` | Apply/verify/revert на синтетическом сервере. |
| `bootstrap-lifecycle.test.mjs` | Install/update/uninstall из release-каталога. |
| `discovery-readonly.test.mjs` | Read-only autodiscovery без побочных записей. |
| `fault-injection.test.mjs` | Failpoints и автоматический rollback после каждого шага записи. |
| `final-byte.test.mjs` | Установку именно из финальных ZIP/TAR и полный состав архива. |
| `help-readonly.test.mjs` | Справку CLI без создания файлов и сетевых запросов. |
| `journal-contract.test.mjs` | Формат, права и доказательства durable journal. |
| `journal-crash.test.mjs` | Восстановление после принудительного завершения процесса. |
| `lifecycle-path-alias.test.mjs` | Канонизацию путей и совместимость старого journal key. |
| `lifecycle-rollback.test.mjs` | Возврат версии инструмента и `ui-dist` при ошибке обновления. |
| `manifest-acceptance.test.mjs` | Строгую проверку manifest, hashes и baseline. |
| `panel-preference.test.mjs` | Сохранение opt-in выбора ресайза между apply/reapply. |
| `review-regressions.test.mjs` | Исправленные ранее критичные регрессии. |
| `scripts.test.mjs` | PowerShell/Bash bootstrap-обёртки и их JSON-контракт. |
