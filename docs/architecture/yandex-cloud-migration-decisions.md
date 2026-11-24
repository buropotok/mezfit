# MezFit — архитектурные решения по переносу приложения в Yandex Cloud

**Статус:** утверждённые решения и план поэтапной миграции; реализация частичная.  
**Зафиксировано:** 2026-11-23, 06:10 MSK.  
**Репозиторий:** [buropotok/mezfit](https://github.com/buropotok/mezfit).  
**Назначение:** единая точка входа для последующих чатов/агентов и системного ревью; фиксирует, что принято, что уже внедрено, что находится в PR и что делать дальше.

> **Это архитектурный документ, а не отчёт об успешном production cutover.**
> Статусы конкретных ресурсов/сертификатов/CI могут измениться после указанной даты.
> Перед действиями проверять фактический `main`, статус PR, GitHub Actions и Yandex Cloud.
> Обязательны корневой [AGENTS.md](../../AGENTS.md) и
> [архитектура локального хранения](local-first-storage-sync.md).

## 1. Главные решения и инварианты

| ID | Принятое решение | Следствие / запрет |
| --- | --- | --- |
| YC-01 | Поэтапно перенести публичный веб-хостинг и привилегированный backend MezFit с Cloudflare на Yandex Cloud. | Не делать «одномоментный» cutover, не удалять рабочую Cloudflare-инфраструктуру до проверки замены. |
| YC-02 | **Dexie Cloud остаётся единственной authoritative базой бизнес-данных.** | Не создавать вторую БД бизнес-сущностей в Yandex или Cloudflare D1; не писать собственную синхронизацию; сохранить Dexie Cloud Addon и realm ACL. |
| YC-03 | **Один** Yandex API Gateway — единая HTTPS-точка входа для SPA и будущих серверных API. | Не создавать второй Gateway для второго домена или отдельного входа Telegram. |
| YC-04 | SPA — Vite/React, файлы в публичном Yandex Object Storage. | Бакет служит только для статических браузерных файлов, а не пользовательских данных, приватных ключей или бизнес-бэкапов. |
| YC-05 | **`mezfit.online` — предпочтительный основной домен**, `mezfit.ru` сохраняется как дополнительный. | Отдельные DNS-зоны и сертификаты, но один Gateway, одна сборка и одна Dexie Cloud база. Не отключать `.ru` из-за проблемы идентификации домена на Госуслугах. |
| YC-06 | Пока нет Yandex backend, маршруты `/api` и `/api/*` намеренно отвечают JSON `503`. | **Никакого скрытого проксирования в Cloudflare Worker** и никакого SPA fallback для `/api/*`. Статический сайт не считать полностью мигрированным продуктом. |
| YC-07 | Существующий Telegram Mini App продолжает использовать подписанное `initData`. Для обычного браузера — **отдельная Telegram Login OIDC**-авторизация, проверяемая на сервере. | Нельзя конструировать фальшивое `initData` из браузерной cookie или выдавать Dexie Cloud роли по одному факту OIDC-входа. |
| YC-08 | Все операции инфраструктуры — GitHub Actions с GitHub OIDC → короткоживущий Yandex IAM token, ручными `Preview` и `Apply` и точными ключами подтверждения. | Без статических Yandex ключей в репозитории, без автоматического неявного Apply, без молчаливого перезаписывания/drift repair чужих ресурсов. |
| YC-09 | Telegram OIDC Client Secret первоначально хранится в **GitHub Actions Secret**; workflow переносит его в **Yandex Lockbox** и создаёт отдельный runtime service account. | Вручную заполнять Lockbox не требуется. Секреты не попадают в исходники, PR, обычные Variables, логи или frontend. IAM-права для bootstrap не могут появиться у workflow сами собой. |
| YC-10 | Работоспособность, авторизация, производительность и DNS подтверждаются отдельно. | Не путать «SPA открывается», «OIDC установил личность», «backend отвечает», «данные синхронизируются» и «можно переключать пользователей». |
| YC-11 | **Решение владельца 2026-11-24:** сохранить действующую идентификацию `userId = tg:<telegramUserId>` для всех пользователей MVP. Провайдер-независимую идентификацию и VK ID отложить. | Не менять префикс, ID, realm hash, membership, ownership, схему бизнес-данных и ключи локальных данных ради альтернативного входа; не создавать identity registry или синтетические ID. [Аудит зависимостей](../../audit/2026-11-24_telegram_identity_dependency_audit.md). |
| YC-12 | Независимость от Telegram как среды исполнения, а не как провайдера идентификации: после первичного входа полноценная повседневная работа web/Capacitor без VPN и обязательных обращений к Telegram. | Серверная сессия Mezfit, восстановление и продление сессии, выдача/обновление Dexie токенов и защищённые API без повторного обращения к Telegram при действующей сессии. Сохранить проверку ролей/realms, безопасный отзыв, сроки действия и изоляцию аккаунтов. |

### 1.1 Канонические границы данных

Существующая бизнес-архитектура **не заменяется** миграцией веб-хостинга:

```text
React Coach / Client UI
        ↓
typed domain repositories / application services
        ↓
Dexie.js / IndexedDB (local working subset)
        ↕
Dexie Cloud Addon
        ↕
Dexie Cloud (единственная authoritative бизнес-БД, realm ACL)
```

Привилегированные действия (проверка Telegram identity, выдача Dexie Cloud токенов, приглашения/членство, контроль доступа, отдельные API/медиа-операции) **обязательно** остаются серверными. Сейчас их значительная часть находится в Cloudflare Worker; переносить их на Yandex следует по отдельным контрактным срезам с сохранением всех бизнес-проверок. Cloudflare D1/R2/Workers, связанные с legacy API, медиа и техническими миграционными задачами, не объявлены автоматически удалёнными.

Существующая интеграция некоторых медиа с **Yandex Object Storage/Cloud Functions** (включая коммуникационные медиа и FitnessProgramer Base 2) — **отдельный уже существующий подсистемный контур**, а не доказательство завершённого переноса основного backend. Его контракты, fallback и ограничения описаны в [local-first-storage-sync.md](local-first-storage-sync.md) и профильных документах коммуникаций. Новый SPA-бакет с ними не смешивать.

### 1.2 Идентификация: решение владельца от 2026-11-24

Целевой аудит обнаружил зависимость от текущего ID в токенах Dexie Cloud, ACL, relationship realms, профилях, уведомлениях, media signer и локальных базах/кешах. Масштабная смена семантики ID ради одного дополнительного способа входа несоразмерна риску регрессий. Основной сценарий привлечения клиентов — приглашение тренером через Telegram. VPN при первоначальном входе допустим; повторный вход возможен при истечении/отзыве сессии, смене устройства или очистке данных.

- Для старых и новых пользователей MVP сохранять `tg:<реальный Telegram ID>` как внутренний `userId`. Mini App и браузерный OIDC должны приводить к одной и той же подтверждённой идентичности. Не доверять ID, переданному клиентом.
- Не реализовывать унификацию под несколько провайдеров, `mz:<uuid>`, синтетический числовой диапазон `tg:`, сопоставление VK ID или отдельный реестр identity в текущем roadmap. Обсуждавшийся числовой диапазон остаётся только отложенным вариантом, не контрактом.
- Приоритет после OIDC — защищённая серверная сессия, восстановление после перезапуска, продление без Telegram, Dexie Cloud token exchange/refresh с неизменным `sub`, перенос необходимых API в Yandex. Не ослаблять серверные ACL. Конкретная политика TTL/refresh/revocation требует отдельного проектирования.
- Проверить работу web/Capacitor на реальных устройствах без VPN после входа; отдельно подтвердить доступность Dexie Cloud, медиа и других обязательных зависимостей. Telegram Bot API, уведомления и обновление Telegram-профилей остаются интеграциями, но их недоступность не должна блокировать основной сценарий.
- Вернуться к провайдер-независимой identity только при подтверждённой существенной бизнес-потребности и новом решении владельца. Перед этим повторить [аудит зависимостей Telegram ID](../../audit/2026-11-24_telegram_identity_dependency_audit.md) на актуальном main, согласовать план сохранения ID/ACL, совместимость и откат.

## 2. Принятая топология Yandex Cloud

```text
mezfit.online (основной, после DNS+TLS) ──┐
                                         ├─► Yandex API Gateway: mezfit-web
mezfit.ru (дополнительный, после TLS) ───┘           │
Технический *.apigw.yandexcloud.net ────────────────┤
                                                     ├─ /, /assets/*, SPA fallback
                                                     │       └─ Yandex Object Storage
                                                     │          mezfit-web-<YC_FOLDER_ID>
                                                     ├─ /auth/* [план PR #886]
                                                     │       └─ private Cloud Function
                                                     │          Telegram OIDC/JWKS
                                                     └─ /api, /api/* → 503 JSON
                                                         до отдельной миграции API
```

**Размещено/настроено:**

| Ресурс | Имя/идентификатор | Назначение |
| --- | --- | --- |
| Yandex folder | `b1g774t6sgop4rakjob7` | Единый целевой каталог. |
| Существующий GitHub deploy service account | `mezfit-github-deploy` / `ajeijn4c6747d0l7dmel` | Получает IAM token через существующую OIDC federation; оператор Yandex. |
| Object Storage | `mezfit-web-b1g774t6sgop4rakjob7` | React SPA, публичное чтение отдельных объектов. |
| API Gateway | `mezfit-web` | Единый SPA/Gateway, без прокси в Cloudflare. |
| Технический адрес Gateway | `https://d5dnrvd45b0b0s0u95g3.3zvepvee.apigw.yandexcloud.net/` | Доступен без собственного DNS; адрес взят из успешного Prepare. |
| Публичная Cloud DNS зона `.ru` | `mezfit-ru` / `mezfit.ru.` | Управление DNS записями для второго домена. |
| Публичная Cloud DNS зона `.online` | `mezfit-online` / `mezfit.online.` | Управление DNS для основного домена. |
| Управляемый сертификат `.ru` | `mezfit-ru-web` | Независимая проверка и выпуск TLS. |
| Управляемый сертификат `.online` | `mezfit-online-web` | Независимая проверка и выпуск TLS. |
| OIDC Cloud Function, **после PR #886 + Apply** | `mezfit-browser-login` | Серверная проверка Telegram Login в обычном браузере. |
| Runtime service account, **после PR #886 + Apply** | `mezfit-browser-auth-runtime` | Только целевой доступ к payload одного OIDC-секрета. |
| Lockbox, **после PR #886 + Apply** | `mezfit-browser-telegram-oidc` | OIDC client ID/secret и случайный ключ браузерной сессии. |

**Важно о бакете:** только публичное чтение объектов, без публичного листинга и чтения конфигурации. Публикация загружает готовый `dist/`, **не удаляет** объекты, загружает `index.html` последним. Хешированные файлы в `assets/` кешируются длительно; `index.html` — `no-store`. Запрещены symlinks, source maps (`*.map`), скрытые файлы (`.env` и т. п.); пустые `.gitkeep` пропускаются, непустые запрещены. Детали — [оператор публикации](../../tools/yandex-infrastructure/publish_spa.py).

**Важно о шлюзе:** маршруты SPA/статических файлов конфигурируются в [web_hosting.py](../../tools/yandex-infrastructure/web_hosting.py). После создания/привязки ресурсов операторы проверяют владельца, контракт OpenAPI, разрешённые домены/сертификаты и семантическое соответствие; непредусмотренный drift отклоняется вместо принудительного обновления.

## 3. Домены, DNS и HTTPS

**Бизнес-причина:** у `mezfit.ru` возникли сложности с подтверждением/идентификацией на Госуслугах. Домен **не удаляем**; в качестве основного выбираем `mezfit.online`. Не считать саму смену домена исправлением всех интеграций и авторизации.

Для каждого домена независимо:
1. Зарегистрирован/контролируется у регистратора; публичная Yandex Cloud DNS зона существует.
2. У регистратора NS делегированы на `ns1.yandexcloud.net` и `ns2.yandexcloud.net`; необходимо проверить DNSSEC/DS и фактическое делегирование через публичный DNS.
3. Точная запись `_acme-challenge.<домен>.` типа CNAME создаётся из значения managed Certificate Manager.
4. Сертификат имеет **`ISSUED`**; статус `VALIDATING` **не подходит** для подключения.
5. Отдельно подтверждённой операцией домен прикрепляется к **существующему** Gateway с этим сертификатом, а apex ANAME указывает на его техническое имя.
6. Проверяются реальный HTTPS/Host routing, API и клиентское поведение без VPN.

На 2026-11-23 пользователь сообщил, что **сменил NS, но распространение делегирования ещё не завершилось**. По последним рассмотренным логам обе CNAME для проверки добавлены в Cloud DNS, а сертификаты оставались в `VALIDATING`. Это **снимок состояния**, а не подтверждение текущего публичного DNS. Преждевременный `activate_online` корректно завершился ошибкой `certificate status is VALIDATING; require ISSUED`. Не обходить этот guard.

**Origin-изоляция:** `https://mezfit.online` и `https://mezfit.ru` имеют раздельные cookies, IndexedDB/Dexie-кеш и localStorage даже при общей Dexie Cloud БД. В конечном пользовательском опыте использовать **один канонический origin** `mezfit.online`, в том числе Telegram Mini App URL, OAuth callback/allowlists и публикуемые ссылки. `mezfit.ru` возможно оставить как дополнительный адрес/будущий серверный redirect 301, **но redirect ещё не реализован и требует отдельного решения** после проверки auth/ссылок. Не считать оба домена «одной браузерной сессией».

Точный оператор: [dual_domains.py](../../tools/yandex-infrastructure/dual_domains.py). Процедура: [yandex-dual-domains.md](../operations/yandex-dual-domains.md).

## 4. Telegram: две строго раздельные схемы аутентификации

### 4.1 Действующий Telegram Mini App

Источник доверия — подписанное Telegram `initData`; сервер проверяет подпись и устанавливает реального пользователя, а авторизация последующих привилегированных операций и Dexie Cloud realm/role constraints остаётся за сервером/существующими контрактами. Не переносить проверку в React. Пока Yandex `/api/*` не мигрирован, обычный браузер **не является полноценной заменой Mini App**.

### 4.2 Новый browser login — **PR #886, ещё не в `main` на дату записи**

Внешний браузер должен видеть `«Авторизация через Telegram»` и кнопку `«Войти через Telegram»`, а не исключительно требование открыть Mini App. Для этого выбран официальный **Telegram Login / OIDC** c Authorization Code + PKCE S256.

Планируемая реализация на Yandex:
- `GET /auth/start`: генерация случайных `state`/`nonce`/PKCE-verifier, краткоживущая подписанная cookie, redirect в Telegram.
- `GET /auth/callback`: серверный обмен code с OIDC Client Secret, проверка Telegram JWKS/RS256, issuer, audience, nonce, времени действия и Telegram identity.
- `GET /auth/session`: проверка подписанной `Secure; HttpOnly; SameSite=Lax` браузерной session-cookie; возврат только подтверждённой публичной идентичности.
- `POST /auth/logout`: требование совпадающего Origin и завершение браузерной сессии.
- Cookie привязана к hostname; сессия не означает доступ к Dexie Cloud, API, Coach/Client данным; никакой подделки `initData`.
- Приватная Cloud Function вызывается Gateway от имени разрешённого service account. Browser identity не получает bot secret, OIDC secret, privileged token или произвольный Cloud Function invoke.

**Внешняя настройка BotFather** для `@mezfit_bot`:
- Redirect URIs: `https://d5dnrvd45b0b0s0u95g3.3zvepvee.apigw.yandexcloud.net/auth/callback`, `https://mezfit.online/auth/callback`, `https://mezfit.ru/auth/callback`.
- Trusted Origins соответственно эти три `https://<host>` без пути; Native Login не требуется.
- `Signing Algorithm: RS256`. Client Secret — **не** Telegram Bot API token.

**Утверждённый способ хранения секрета (изменён после обсуждения):**
- GitHub Actions **Variable** `TELEGRAM_LOGIN_CLIENT_ID` = `8635045061` (публичный идентификатор).
- GitHub Actions **Secret** `TELEGRAM_LOGIN_CLIENT_SECRET` = секрет из BotFather; никогда не размещать значение в репозитории, обсуждениях, обычных Variables или логах.
- При `prepare/apply` workflow сам создаёт отдельный runtime SA, deletion-protected Lockbox, три ключа `client_id`, `client_secret`, `session_secret` (последний генерируется случайно), выдаёт только узкий `lockbox.payloadViewer` на этот секрет и публикует Node.js Cloud Function.
- ID SA/Lockbox/version определяются из API Yandex Cloud. Ручное заполнение Lockbox и отдельные Variables `YC_LOGIN_RUNTIME_SA_ID` / `YC_LOGIN_LOCKBOX_ID` / `YC_LOGIN_LOCKBOX_VERSION_ID` **не требуются**.
- Операции идемпотентны; автоматическая ротация/перезапись уже существующего секрета запрещены. Для ротации — отдельный утверждённый процесс.
- Разделить аккаунт GitHub-deploy от runtime identity. GitHub-deploy **не должен** регулярно читать содержимое Lockbox; широкий bootstrap-доступ ограничить по времени.

**IAM bootstrap:** создание SA, Lockbox, IAM bindings и функции требует предварительно назначенных прав у `mezfit-github-deploy`. В PR #886 указаны необходимые для bootstrap роли `iam.serviceAccounts.admin`, `lockbox.admin`, `functions.admin` (для Gateway сохраняется `api-gateway.editor`). При отсутствии прав будет 403; **workflow не может повысить себе права**. `lockbox.admin` чувствителен, поскольку даёт доступ к payload: после первоначальной установки оценить отзыв временного административного grant. Никаких ручных действий с самим OIDC секретом в консоли Яндекса не требуется.

**Функциональная граница PR #886:** после входа можно подтвердить браузерную личность и завершить сеанс, но **ещё нельзя работать с Coach/Client, тренировками, программами и Dexie Cloud**. Это требует следующего backend-среза с полноценными защищёнными API и проверкой realm ACL.

PR: [#886 — Telegram browser OIDC with Yandex server-side verification](https://github.com/buropotok/mezfit/pull/886). Документация в его ветке: `docs/operations/yandex-browser-telegram-login.md`. На момент фиксации PR **открыт**, исправляется CI; ничего из него нельзя описывать как уже развёрнутый production backend.

## 5. GitHub Actions: управляемое развёртывание

Общие правила всех Yandex operator workflows:
- только `workflow_dispatch`, `main`, owner-restricted, read-only `Preview` по умолчанию;
- `Apply` отдельно и только после точного ключа; создавать недостающие ресурсы, не удалять существующие;
- GitHub OIDC → временный IAM token сервиса Яндекса, без долговременных ключей в GitHub;
- отсутствие прав → fail closed/403, не «исправлять» расширением ролей без решения владельца;
- readback-проверка ресурсов после мутаций; drift/конфликт → остановка и ручное разбирательство;
- локальные `npm`/`typecheck`/`test`/`build` не запускать вместо CI; тесты и билд выполняет GitHub Actions по правилам `AGENTS.md`.

| Workflow / файл | Action / фаза | Ключ `Apply` / подтверждение | Статус |
| --- | --- | --- | --- |
| [Prepare Yandex Cloud DNS](../../.github/workflows/setup-yandex-infrastructure.yml) | создание зоны `mezfit.ru` | `CREATE_MEZFIT_RU_DNS` | В `main`, зона создана. |
| [Prepare Yandex Web Hosting](../../.github/workflows/prepare-yandex-web.yml) | `preview` / `apply` | `PREPARE_MEZFIT_WEB` | В `main`, инфраструктура создана. |
| [Publish MezFit SPA to Yandex](../../.github/workflows/publish-yandex-spa.yml) | ручная публикация SPA | `PUBLISH_MEZFIT_WEB` | В `main`, успешная публикация подтверждена пользователем. |
| [Prepare MezFit Dual Domains](../../.github/workflows/prepare-mezfit-dual-domains.yml) | `prepare_online` | `PREPARE_MEZFIT_ONLINE` | В `main`. |
| То же | `validate_online` | `VALIDATE_MEZFIT_ONLINE` | В `main`, ранее применено для CNAME. |
| То же | `activate_online` | `ACTIVATE_MEZFIT_ONLINE` | В `main`; выполнение блокируется, пока TLS не `ISSUED`. |
| То же | `validate_ru` | `VALIDATE_MEZFIT_RU` | В `main`, ранее применено для CNAME. |
| То же | `activate_ru` | `ACTIVATE_MEZFIT_RU` | В `main`; независимо от `.online`. |
| `Prepare MezFit Browser Telegram Login` | `prepare` / `apply` | `PREPARE_MEZFIT_BROWSER_LOGIN` | **Только PR #886**, не `main` до merge. |
| То же | `activate` / `apply` | `ACTIVATE_MEZFIT_BROWSER_LOGIN` | **Только PR #886**, требует отдельно подготовленную функцию. |

**Операции не используют один общий ключ.** В каждом workflow есть поле `confirm`, но значение зависит от выбранного действия.

В Yandex-развёртывании не трогать существующие Cloudflare deployment workflows и Dexie Cloud privileged Actions. Не переиспользовать `DEXIE_CLOUD_WRITE_KEY` для веб-хостинга/логина: его использование отдельно ограничено `AGENTS.md`.

## 6. Состояние работ на дату записи

| Этап | Состояние | Доказательства / следующий шаг |
| --- | --- | --- |
| DNS-база `mezfit.ru` | **Внедрена** | [PR #881](https://github.com/buropotok/mezfit/pull/881) merged; публичная DNS-зона создана. |
| SPA bucket / API Gateway / первый managed certificate | **Внедрено** | [PR #882](https://github.com/buropotok/mezfit/pull/882) merged. Readback-совместимость исправлена в [PR #883](https://github.com/buropotok/mezfit/pull/883), merged. |
| Первая успешная загрузка SPA | **Подтверждена** | Исправлен пустой `fonts/.gitkeep` в [PR #884](https://github.com/buropotok/mezfit/pull/884), merged; пользователь подтвердил успешный Publish. |
| Два домена и DNS/TLS операторы | **Код в `main`** | [PR #885](https://github.com/buropotok/mezfit/pull/885), merged. DNS CNAME применялись; NS были изменены пользователем, публичное делегирование/`ISSUED` не подтверждены. |
| Открытие сайта по техническому Yandex URL | **Статика доступна пользователю** | В браузере показан экран «Откройте приложение в Telegram». Полная auth/backend функциональность не проверена. |
| Browser Telegram OIDC | **Код в PR, ещё не развёрнут** | [PR #886](https://github.com/buropotok/mezfit/pull/886), открыт; до merge, настройки GitHub Secret, IAM bootstrap и Apply не считать рабочим. |
| Миграция защищённых `/api/*` с Cloudflare | **Не выполнена** | На Yandex пока намеренный 503; будущие PR должны мигрировать маршруты, auth, ACL и интеграции. |
| Полный пользовательский cutover и отказ от Cloudflare | **Не выполнен** | Нужны полноценные smoke/regression checks, mobile/Telegram, DNS/TLS, media и rollback. |

## 7. Производительность: наблюдение, не установленная причина

Пользователь наблюдал **около 20 секунд** открытия SPA через технический Yandex Gateway и почти мгновенное открытие через Cloudflare Worker на мобильной сети (с VPN). **Корневой источник задержки не измерен:** на тот момент нельзя было открыть Network/DevTools.

Фактическая схема сейчас: `API Gateway → Object Storage` для HTML/JS/CSS, **без выделенного Yandex CDN для этой SPA**. Возможные, но **не подтверждённые** причины: RTT/сеть, TTFB Gateway/Object Storage, отсутствие/особенности HTTP-сжатия, вес JS/CSS, блокирующая загрузка Telegram SDK из `index.html`, запуск приложения. Смена hostname на `mezfit.online` сама по себе этот симптом не исправит.

Перед оптимизацией:
1. Снять холодную загрузку через Chrome Network: `document`/TTFB, JS/CSS transfer/size и Telegram SDK.
2. Сверить `Content-Encoding`, `Cache-Control`, `Content-Type` и Yandex Gateway latency.
3. Проверить Yandex URL и CF на **одном устройстве/одной сети**, с одинаковым VPN, холодным кешем.
4. Если узкое место в доставке статики — рассмотреть **Yandex CDN / сжатие / корректное кеширование** отдельным решением; не добавлять CDN «наугад».
5. Измерять отдельно время открытия HTML, загрузку приложения и проверку identity/API.

## 8. Что ещё предстоит (последовательность без ложной готовности)

1. Проверить фактические NS/DS, CNAME и выдачу managed TLS `ISSUED` для обоих доменов. Затем отдельно `activate_online` и при необходимости `activate_ru`; проверить HTTPS в публичном DNS, не только в консоли.
2. Довести PR #886 до успешного CI/review. После merge добавить OIDC Client ID в GitHub Variable, Client Secret в GitHub Secret, обеспечить bootstrap IAM-права; выполнить `prepare` Preview/Apply, `activate` Preview/Apply, перепубликовать SPA, проверить Telegram OIDC через реальный browser. Не считать эту операцию переносом бизнес-API.
3. После OIDC (владелец подтвердил завершение первоначального браузерного входа 2026-11-24; это не подтверждение готовности бизнес-API) спроектировать и реализовать **независимую серверную сессию Mezfit** на Yandex для browser-session и Mini App `initData` с прежним `userId = tg:<telegramUserId>` и серверной проверкой ролей/realms. Обеспечить восстановление/продление сессии и Dexie token exchange/refresh без Telegram в повседневном сценарии. Не включать в этот этап унификацию ID и VK ID (YC-11/YC-12). Нельзя обходить текущий Worker просто для прохождения теста.
4. Поэтапно перенести необходимые Worker endpoints, Dexie token exchange, приглашения/членство/realm ACL и другие привилегированные операции. На каждом этапе утвердить контракт, проверку подписи, permissions, ошибки и rollback.
5. Аудировать Cloudflare D1/R2/Durable Objects, Telegram bot integration, коммуникационные media, Yandex media signer и публичные объекты. Миграция инфраструктуры не должна перенести авторитетные бизнес-данные из Dexie Cloud и не должна прервать существующие медиа-ссылки/синхронизацию.
6. Провести сквозные тесты ролей Coach/Client, offline/online Dexie sync, Telegram Mini App, browser auth, медиа, уведомлений, ссылок, реальных устройств **без VPN**. Отдельно измерить производительность Yandex.
7. Утвердить canonical origin `mezfit.online`, изменить адрес Mini App/redirect allowlists/публичные ссылки, отдельно решить redirect для `mezfit.ru`. Только после наблюдения и плана отката переносить основной трафик и выводить из эксплуатации лишние Cloudflare ресурсы.

**Открытые технические вопросы, НЕ утверждённые как готовая реализация:** точная форма целевого Yandex backend для всех Worker-маршрутов; browser-session → полноценная Dexie token/realm модель; миграция Telegram Bot/Webhook; перечень CF-зависимостей, которые останутся; CDN/сжатие; окончательная политика redirect `.ru` → `.online`; момент production cutover и удаления Cloudflare.

## 9. Инструкция следующему чату / агенту

1. **Сначала прочитать этот документ**, корневой [AGENTS.md](../../AGENTS.md), [local-first-storage-sync.md](local-first-storage-sync.md) и нужную профильную инструкцию из `docs/operations`.
2. Проверять актуальные `main`, PR и Actions: **PR merged ≠ Apply выполнен ≠ ресурс ACTIVE ≠ продукт работает**. Не переносить старые статусы сертификатов/CI на текущий момент.
3. Сохранять архитектурные границы: Dexie Cloud canonical, realm ACL и Telegram server-side identity; никакого второго authoritative store, no fake `initData`, no CF proxy как неявный workaround.
4. Работа в `buropotok/mezfit`: выполнить `AGENTS.md`, проверить исходники тестов и системные последствия, ознакомиться с `audit/`; не переписывать существующие тесты ради прохождения CI. После PR не ждать CI, кроме отдельного запроса пользователя на его анализ.
5. При работе с PR #886 проверить, что он **открыт**, до коммита; учитывать текущие фиксы CI и изменения GitHub Secrets → Lockbox. Не считать README/docs из ветки `main` источником того, что ещё не merge.
6. Не запрашивать и не печатать секреты. Из GitHub допускаются только названия Secrets/Variables, но не их значения. Инфраструктурные операции — только с явным owner-confirmed Apply.

### Связанные документы и первичные источники

- [Текущая local-first/Dexie архитектура](local-first-storage-sync.md)
- [Yandex DNS foundation](../operations/yandex-dns-foundation.md)
- [Yandex SPA hosting and security](../operations/yandex-web-hosting.md)
- [Yandex dual domains](../operations/yandex-dual-domains.md)
- [Browser Telegram OIDC (PR #886; отсутствует в main до merge)](https://github.com/buropotok/mezfit/blob/feat/yandex-telegram-browser-oidc/docs/operations/yandex-browser-telegram-login.md)
- [`web_hosting.py` — Gateway contract](../../tools/yandex-infrastructure/web_hosting.py)
- [`publish_spa.py` — static deploy contract](../../tools/yandex-infrastructure/publish_spa.py)
- [`dual_domains.py` — DNS/managed TLS/domain operator](../../tools/yandex-infrastructure/dual_domains.py)
- [PR #881](https://github.com/buropotok/mezfit/pull/881), [#882](https://github.com/buropotok/mezfit/pull/882), [#883](https://github.com/buropotok/mezfit/pull/883), [#884](https://github.com/buropotok/mezfit/pull/884), [#885](https://github.com/buropotok/mezfit/pull/885), [#886](https://github.com/buropotok/mezfit/pull/886)
- [Cloudflare migration infrastructure](migration-infrastructure.md) — **другая** подсистема импорта бэкапов Gym Keeper; не считать её описанием переноса основного backend в Yandex.
