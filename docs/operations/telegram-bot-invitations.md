# Приглашения клиентов через @mezfit_bot

Webhook принимает POST на
`https://mezfit.buropotok.workers.dev/api/telegram/bot-webhook`.
Worker использует существующий токен бота, отдельный
`TELEGRAM_BOT_WEBHOOK_SECRET` и прежние credentials Dexie Cloud и репликации.

Техническая запись D1 связывает кнопки с получателем и приглашением. Она
не хранит исходный токен. Отмена действует до первого принятого нажатия
«Принять» и относится к одному предложению. Одно предложение действует
24 часа с момента команды, подтверждение принятия хранится 30 дней для
проверки готовности. Истёкшие записи удаляются при создании следующего
предложения. Ошибку принятия можно повторить с той же кнопки. Если Worker
прервался во время обработки, повтор станет возможен через минуту.

## Развёртывание

1. До merge проверь по имени наличие GitHub Actions Secret
   `TELEGRAM_BOT_WEBHOOK_SECRET`. Если значение сохранилось только в GitHub,
   создай новое до первого подключения и сохрани его в защищённом хранилище
   оператора. GitHub не возвращает сохранённое значение. В Codespaces без
   shell tracing можно выполнить:

   ```bash
   webhook_secret=$(openssl rand -hex 32)
   printf '%s' "$webhook_secret" | gh secret set TELEGRAM_BOT_WEBHOOK_SECRET --repo buropotok/mezfit
   ```

   Не выводи значение. Перед закрытием сессии используй защищённое
   хранилище оператора для последующего шага.
2. После merge дождись штатного Deploy Mezfit на `main`. Пока переменная
   Actions `TELEGRAM_BOT_INVITES_ENABLED` отсутствует или равна `false`,
   новые приглашения по-прежнему ведут в Mini App.
3. Оператор бота проверяет `getWebhookInfo` в защищённой терминальной
   сессии. В переменных `bot_token` и `webhook_secret` должны быть
   действующий токен бота и тот же секрет, который передан Worker.
   curl читает URL с токеном через отдельный файловый дескриптор.
   Перед началом отключи shell tracing.

   ```bash
   bot_api() {
     curl --silent --fail --max-time 15 --config /dev/fd/3 "${@:2}" \
       3< <(printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$bot_token" "$1")
   }
   bot_api getWebhookInfo | jq -e '
     select(.ok == true and (.result.url | type) == "string") |
     .result | {url, allowed_updates, pending_update_count, max_connections, has_custom_certificate}'
   ```

   Сохрани прежнюю конфигурацию в защищённом месте. При уже заданном URL
   или иных потребителях обновлений остановись и проверь совместимость
   с оператором бота. До регистрации должно быть подтверждено, что
   достаточно событий `message` и `callback_query`.
4. В согласованный момент зарегистрируй webhook по точному URL. Операция
   сохраняет накопленные события.

   ```bash
   endpoint=https://mezfit.buropotok.workers.dev/api/telegram/bot-webhook
   (
     set -euo pipefail
     current_url=$(bot_api getWebhookInfo | jq -er 'select(.ok == true) | .result.url | strings')
     if [[ -n "$current_url" && "$current_url" != "$endpoint" ]]; then
       echo 'У бота уже настроен другой webhook.' >&2
       exit 1
     fi
     [[ "$webhook_secret" =~ ^[A-Za-z0-9_-]{1,256}$ ]]
     printf '%s' "$webhook_secret" |
       jq -Rs --arg url "$endpoint" '{
         url: $url, secret_token: ., allowed_updates: ["message","callback_query"],
         drop_pending_updates: false
       }' |
       bot_api setWebhook --header 'Content-Type: application/json' --data-binary @- |
       jq -e '.ok == true and .result == true'
     bot_api getWebhookInfo | jq -e --arg url "$endpoint" '
       .ok == true and .result.url == $url and
       (.result.allowed_updates | sort) == ["callback_query","message"]'
   )
   ```
5. На согласованном тестовом клиенте открой действительное приглашение
   в формате `?start=invite_…`. Проверь имя тренера, «Отмена» и отсутствие
   новых аккаунта и связи после неё. Открой снова, нажми «Принять» и сверь
   роль `client` и активную D1-связь, канонический realm и две подтверждённые
   записи Dexie Cloud, outbox и снимок в YDB. При задержке проверь кнопку
   «Проверить готовность». Проверь URL кнопки `https://mezfit.online/`,
   открытие Mini App и доставку действующего уведомления.
6. Установи GitHub Actions variable `TELEGRAM_BOT_INVITES_ENABLED=true` и
   запусти Deploy Mezfit на `main`. Проверь выдачу новой ссылки
   `?start=invite_…` и ранее сохранённую ссылку `?startapp=invite_…`.
   После отдельного согласования вывода из эксплуатации прежних ссылок
   убери временную переменную вместе с ветвлением выдачи ссылок.

## Вход на сайт из бота

После принятия приглашения и подтверждения реплики кнопка «Открыть Mezfit»
может открывать Bot API `login_url` на
`https://mezfit.online/auth/telegram-login`. Telegram запрашивает передачу
данных, сайт показывает имя проверенного аккаунта и кнопку подтверждения.
При отказе передать данные открывается обычный вход через Telegram OIDC.
Основной браузерный интерфейс приложения подключается отдельно.

1. Перед включением проверь в BotFather привязку `mezfit.online` к
   `@mezfit_bot` именно для Bot API LoginUrl. Сохрани текущие разрешённые
   URL прямого OIDC. В GitHub проверь по имени наличие `TELEGRAM_BOT_TOKEN`.
   Новый способ подписи не использует `TELEGRAM_BOT_WEBHOOK_SECRET`.
2. На `main` запусти **Prepare MezFit Browser Telegram Login** с
   `action=login-url`, `mode=preview`. Нужны подтверждённый домен
   `mezfit.online`, отключённая запись URL в Gateway и отсутствие внешнего
   логирования query на маршруте. Оператор проверяет отключение логов Gateway
   по `logOptions.disabled`; логирование новой версии функции отключено при
   публикации. Если действующий Gateway пишет запросы, остановись и
   согласуй изменение логирования. Этот workflow его не меняет.
3. Выполни `action=login-url`, `mode=apply`, подтверждение
   `ENABLE_MEZFIT_TELEGRAM_LOGIN_URL`. Оператор использует прежний GitHub OIDC
   для короткоживущего IAM и проверяет существующие session key и приватный
   replay bucket. Деплой-аккаунту нужны создание Lockbox секрета, управление
   его scoped IAM, публикация версии функции и PATCH существующего Gateway.
   В Lockbox `mezfit-browser-login-url` хранится только производный секрет
   `login_url_key`. Права чтения payload выдаются существующему
   `mezfit-browser-auth-runtime` на этот секрет. Версия функции
   `browser-login-url` привязана к конкретной версии ключа. При ротации
   Bot API токена сначала верни обычную кнопку, согласуй новую версию
   производного ключа и переиздание тега, затем повтори проверку. Оператор
   автоматически не ротирует ключ и останавливается при расхождении версии.
4. Проверь чистый GET маршрута без параметров и прямой OIDC. Настоящую кнопку
   `login_url` сначала отправь согласованному тестовому клиенту через API
   от имени `@mezfit_bot` в его личный чат. Проверь подтверждение имени,
   чистый адрес после входа, `/auth/session`, совпадение Dexie subject и
   работу прямого OIDC в другом браузере. Проверь отказ, выход и повторное
   открытие в том же браузере без VPN. Не записывай URL с query, токены,
   тела ответов и персональные данные. У браузера Telegram и внешнего
   браузера могут быть отдельные cookie.
5. После smoke установи Actions variable
   `TELEGRAM_BOT_LOGIN_URL_ENABLED=true` и запусти **Deploy Mezfit** на
   `main`. Проверь реальное приглашение. Пока переменная выключена бот
   отправляет обычную URL-кнопку. После завершения перехода этот временный
   переключатель можно убрать вместе с ветвлением кнопки.

Подтверждение на сайте действует до двух минут с момента выдачи данных
Telegram. Оно использует слот краткой cookie OIDC popup с отдельным ключом
и назначением. Оба процесса не принимают cookie друг друга, а действующий
logout очищает слот. Если открыть popup во время подтверждения входа из
бота, нужно завершить один из способов входа.

Для отключения входа из бота сначала верни
`TELEGRAM_BOT_LOGIN_URL_ENABLED=false` и выполни **Deploy Mezfit**.
Затем используй `action=login-url-rollback` сначала в Preview, потом в Apply
с подтверждением `ROLLBACK_MEZFIT_TELEGRAM_LOGIN_URL`. Только новый путь
переключится на чистый redirect к обычному OIDC. Старые кнопки могут
по-прежнему присылать параметры Telegram на этот путь, поэтому не
возобновляй запись полных URL на Gateway. Текущие сессии и прежние теги
функции сохраняются.

## Откат приглашений

Сначала верни `TELEGRAM_BOT_INVITES_ENABLED=false`, выполни Deploy Mezfit
на `main` и проверь выдачу `startapp` ссылок. Продолжай обслуживать уже
выданные ссылки на чат до согласованного окончания перехода, если webhook
исправен. При необходимости оператор восстанавливает ранее сохранённую
конфигурацию или вызывает `deleteWebhook` с `drop_pending_updates=false`.
Аккаунты, membership, связи и снимки outbox/YDB сохраняются.
