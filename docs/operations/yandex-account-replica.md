# Реплика учётных записей Mezfit в Yandex

## Перед merge

Проверь переменные `YC_FOLDER_ID` и `YC_DEPLOY_SA_ID` и действующую GitHub OIDC
федерацию для `main`. Используется существующий российский каталог.

Задай одноразовый GitHub Actions Secret `MEZFIT_ACCOUNT_REPLICATION_SECRET`.
Например, в доверенном локальном терминале с авторизованным `gh`:

```bash
set -o pipefail
python3 -c 'import secrets, sys; sys.stdout.write(secrets.token_urlsafe(32))' |
  gh secret set MEZFIT_ACCOUNT_REPLICATION_SECRET --repo buropotok/mezfit
```

Тот же секрет понадобится будущему CF отправителю. Сохрани доступ к исходному
значению в утверждённом секрет-хранилище или получи его из Lockbox отдельно
через уполномоченного оператора. Apply читает только метаданные существующего
Lockbox, закрепляет версию и не заменяет payload при повторном запуске.

Проверь существующие роли GitHub-deploy. Workflow сам не меняет свои права.

| Роль deploy identity | Область и операция |
| --- | --- |
| `ydb.admin` | Целевой каталог при первом создании serverless БД и её привязки. Для заранее подготовленной управляемой БД, согласно строгому readback, нужны права на чтение списка и на схему и bindings конкретной БД. |
| `iam.serviceAccounts.admin` | Целевой каталог для создания `mezfit-account-replica-runtime`. |
| `iam.serviceAccounts.user` | Право использовать конкретный runtime account при создании версии функции. Если аккаунт ещё не создан, проверь действующее наследование для bootstrap в целевом каталоге. |
| `lockbox.admin` | Целевой каталог для создания Lockbox. Право привязки на выделенном секрете при повторном запуске. |
| `functions.admin` | Целевой каталог для создания private function и её IAM bindings. |
| `api-gateway.editor` | Существующий Gateway `mezfit-web` для чтения и обновления spec. Сохраняются действующие права чтения каталога и сертификатов. |

Runtime получает `ydb.editor` только на выделенную БД `mezfit-account-replica`
и `lockbox.payloadViewer` только на выделенный секрет. `ydb.editor` — сервисная
роль для записи в Managed Service for YDB. Она также даёт права управления
этой конкретной БД. Не выдавай runtime эту роль на каталог.
Gateway вызывает private function через существующий deployment service account
с `functions.functionInvoker` на конкретной функции. Эта же identity проверяет
доступность функции до публикации маршрута. Публичные IAM-привязки запрещены.

## Автоматический Apply

После merge открой [Deploy Mezfit account replica](https://github.com/buropotok/mezfit/actions/workflows/deploy-mezfit-account-replica.yml).
Push в `main` с изменёнными файлами развёртывания запускает Apply сразу.
Кнопка ручного запуска, Preview и код подтверждения для штатного запуска не нужны.

Оператор проверяет существующую спецификацию, создаёт или переиспользует одну
serverless YDB в `ru-central1`, проверяет схему и привязки, публикует приватную
версию и проверяет её доступ к схеме. Затем добавляет единственный POST к
существующему Gateway и сверяет readback. Финальная проверка получает
`401 UNAUTHORIZED` из публичного route без отправительского секрета.
Apply не вставляет тестовые записи. Повторный запуск можно сделать через
**Re-run failed jobs** для актуального запуска на `main`.

Операторы Gateway используют общий concurrency group
`mezfit-yandex-web-gateway`. Оператор browser auth останавливается до мутаций,
пока маршрут реплики активен, поскольку он собирает полную спецификацию.
Операции привязки доменов и readback веб-хостинга распознают точный маршрут.

## Контракт будущего отправителя

`POST https://mezfit.online/api/internal/account-replication` с
`Authorization: Bearer <secret>` и JSON до 32 KiB. Тело содержит ровно
`revision`, `user` и `roles`. Версия — целое число от 1 до
`9007199254740991`. `user` точно соответствует существующему `AppUser`:
числовой положительный безопасный D1 ID, Telegram ID строкой из десятичных
цифр без ведущих нулей в том же безопасном диапазоне, строковый `firstName`,
булевый `isPremium` и nullable `username`, `lastName`, `languageCode`,
`photoUrl`. Допустимые пределы строк — 256 символов для имени пользователя,
имени и фамилии, 64 для языка и 4096 для URL. `roles` содержит от нуля до двух
элементов `client` или `coach`. Порядок канонический, повторы сворачиваются.
Снимок сохраняется по Telegram ID с `Uint64` revision в одной таблице;
D1 ID остаётся внутри snapshots без преобразования.

| HTTP | JSON | Смысл для outbox |
| --- | --- | --- |
| 200 | `{"status":"applied","revision":N}` | Отправленная версия применена. |
| 200 | `{"status":"duplicate","revision":N}` | Повтор уже принятой идентичной версии. |
| 200 | `{"status":"stale","revision":N}` | Реплика уже хранит более новую версию. |
| 409 | `{"error":{"code":"REVISION_CONFLICT"},"revision":N}` | Та же версия содержит другой снимок. Ошибка источника требует разбора. |
| 400 | `{"error":{"code":"INVALID_SNAPSHOT"}}` | Исправить данные или сериализацию перед повтором. |
| 401 | `{"error":{"code":"UNAUTHORIZED"}}` | Проверить секрет отправителя. |
| 503 | `{"error":{"code":"REPLICA_UNAVAILABLE"}}` | Повторить ту же версию позже. |
| 503 | `{"error":{"code":"REPLICATION_NOT_CONFIGURED"}}` | Проверить pinned Lockbox binding и версию функции. |

При неопределённом результате запроса outbox сохраняет версию до явного
подтверждения. Даже успешный статус завершает только конкретную отправленную
версию. Операции с другими HTTP-методами обрабатывает текущий Gateway fallback.
Bearer хранится на сервере и используется только поверх HTTPS. При ротации
согласуй остановку отправителя, обновление его секрета и новой закреплённой
версии функции и только потом возобнови доставку. Оператор текущего этапа
останавливается при расхождении pinned версии и не ротирует секрет.

## Проверка и отключение

Признак готовности Apply — сообщение
`schema and private runtime ready; exact Gateway POST verified`.
До включения отправителя открой [Verify Mezfit account replica](https://github.com/buropotok/mezfit/actions/workflows/verify-mezfit-account-replica.yml),
выбери `main` и нажми **Run workflow**. Workflow доступен владельцу репозитория
после merge файла в `main`. Он использует существующий Actions Secret
`MEZFIT_ACCOUNT_REPLICATION_SECRET` и выводит в Summary
`PASS · applied → duplicate → stale`, если Яндекс подтвердил запись, повтор
той же версии и отклонение устаревшей версии.

Каждый запуск создаёт одну тестовую строку в YDB с идентификатором вне
диапазона реальных Telegram user ID. Повтор того же запуска обновляет эту же
строку. D1 и данные реальных аккаунтов в проверке не участвуют. Отдельно
подтверди доставку CF → Yandex после развёртывания отправителя.

Для аварийного отключения дождись завершения операторов общего Gateway.
В консоли Yandex открой существующий API Gateway `mezfit-web`, сохрани
текущую спецификацию и удали только ключ
`paths["/api/internal/account-replication"]`. Сохрани изменение, сверь diff
спецификации и проверь, что POST реплики вернулся к JSON 503, а `/auth/session`
и `/api/dexie-cloud/tokens` отвечают как прежде. База, снимки, функция и
Lockbox сохраняются. Следующий Apply этого workflow восстановит точный маршрут.
