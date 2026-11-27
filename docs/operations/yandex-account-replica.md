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

## Контракт отправителя

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

## Как выяснить причину сбоя доставки

В SQL-консоли D1 выполни запрос с D1 ID аккаунта:

```sql
SELECT o.attempts, o.last_http_status, o.last_error, o.last_request_id,
       datetime(o.next_attempt_at / 1000, 'unixepoch') AS next_attempt_utc
FROM app_user AS u
JOIN account_replication_outbox AS o ON o.telegram_user_id = u.telegram_user_id
WHERE u.id = 9;
```

- `REQUEST_TIMEOUT` означает таймаут до получения HTTP-ответа. При
  `REQUEST_FAILED` Cloudflare вернул ошибку без HTTP-ответа.
- `REPLICATION_NOT_CONFIGURED` означает отсутствие корректной конфигурации
  секрета в приёмнике. `UNAUTHORIZED` означает отказ в аутентификации.
- `INVALID_SNAPSHOT:firstName` и аналогичные коды показывают поле или этап проверки.
- `REPLICA_UNAVAILABLE:WRITE_COMMIT:TIMEOUT` показывает этап операции YDB и тип
  сбоя. Таймаут подтверждения допускает уже сохранённую версию, поэтому Worker
  безопасно повторит тот же запрос. Для ошибок без распознанного кода YDB тип
  указывается как `UNCLASSIFIED`.
- `HTTP_503_UNRECOGNIZED_RESPONSE` означает, что по ответу нельзя подтвердить
  известную ошибку функции. Проверь логи Gateway и Cloud Functions.

По `last_request_id` ищи событие `ACCOUNT_REPLICA_FAILURE` в логах функции
`mezfit-account-replica`. Оно включает этап и код, а данные аккаунта и секрет
в логи не записываются. При подтверждении доставки поля ошибки очищаются.

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


## Общий снимок профиля и учётных данных

Существующий `account_replication_outbox` обслуживает изменения профиля,
ролей и `password_credentials` в тех же D1-транзакциях. Снимок собирается
запросом на момент доставки. У существующих Telegram-аккаунтов значение
ключа равно прежнему Telegram ID. Для парольного аккаунта ключом служит
его постоянный `user_id` в канонической десятичной строке. Физическое имя
ключа сохранено как `telegram_user_id` в D1 и `telegram_id` в YDB, чтобы
обновление не переносило старые строки и не переименовывало таблицы.
Реальный Telegram ID из подтверждённой привязки записывается отдельно в
`external_telegram_id`.

Действующий POST `/api/internal/account-replication` и
`MEZFIT_ACCOUNT_REPLICATION_SECRET` используются для обеих версий снимка.
В той же `account_replica` JSON-колонка `snapshot` по-прежнему хранит только
профиль и роли. Логин, хеш Argon2id и состояние учётной записи хранятся в
отдельных колонках той же строки. Функция возвращает только статус,
ревизию и диагностические коды. Текущие Telegram/Dexie-маршруты и
`MeResponse` сохраняют формат. Для будущего чтения по Telegram использовать
подтверждённый `external_telegram_id`; для старых строк без состояния
identity допустим прежний ключ.

YDB применяет профиль и учётные данные одной транзакцией с проверкой
монотонной ревизии и конфликтов логина и Telegram ID. Парольный аккаунт без
Telegram передаётся с пустым профилем и без ролей. При отзыве парольный
хеш очищается. После привязки Telegram к парольному аккаунту отзыв
выполняется обновлением `pass_hash`. Физическое удаление такой связи
потребует отдельной операции. Для удалённого аккаунта хранятся только ключ, ревизия и
признак удаления, поэтому старые доставки не вернут его. Точный ACK
полного снимка проверяется в D1. Если облака развернулись в разное время,
старый приёмник отклонит неизвестный снимок, а Worker повторит доставку.
Старый Worker не может отметить полный снимок доставленным. После первой
полной доставки при исправлении деплоя сохраняйте поддержку расширенного
протокола и данные с ревизиями.

### Развёртывание и существующие записи

1. После merge дождаться успешных [Deploy Mezfit](https://github.com/buropotok/mezfit/actions/workflows/deploy.yml)
   и [Deploy Mezfit account replica](https://github.com/buropotok/mezfit/actions/workflows/deploy-mezfit-account-replica.yml).
   Первый применяет D1-миграцию `0037`, второй добавляет колонки к существующей YDB
   и проверяет приёмник. Новых ресурсов, workflow и секретов для этого
   обновления не требуется.
2. Отдельно проверить наличие соответствий в `password_credentials` с помощью
   [D1 preview](../../tools/cloudflare/password-credentials/preview.sql).
   При отсутствии соответствий заполнять их только согласованной операцией
   [backfill](../../tools/cloudflare/password-credentials/backfill.sql).
   Миграция не создаёт учётные данные из пустой таблицы.
3. Для уже существующих соответствий откройте
   [Backfill Mezfit account replica](https://github.com/buropotok/mezfit/actions/workflows/backfill-mezfit-account-replica.yml),
   выберите `main` и `mode=preview`. Оба ID пусты для всей очереди, либо укажите
   диапазон `app_user.id` для пилота. После согласования количества записей
   запустите `mode=apply`. Строки, уже переведённые на полный снимок,
   пропускаются. Для новых изменений продолжает работать существующий cron. Он обрабатывает до 20 готовых
   записей каждые пять минут. У доставленных записей `next_attempt_at`
   становится `NULL`.
4. Сверить в D1 и YDB число полных снимков и ревизии. Для SQL-проверки YDB
   достаточно `SELECT identity_state, COUNT(*) AS total FROM account_replica GROUP BY identity_state;`.
   Вход по паролю требует отдельного включения после проверки модели свежести
   данных и отзыва доступа.
