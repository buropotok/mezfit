# COMM-02 — фактические результаты и решение

Дата подготовки: 2026-11-06. Harness: `comm02-20261106-1`.
Ветка: `feat/comm-02-no-vpn-prototype-637`. [Инструкция](comm02-runbook.md).
**Issue #637 пока не выполнен по приёмке: реальные устройства/refresh/private signed routes не проверены.**
Этот отчёт не закрывает issue и не разрешает production media rollout.

## Проверено в репозитории

| Проверка | Факт | Вывод |
| --- | --- | --- |
| Актуальный main | Основа `484d3eaf`, содержит контракт COMM-01 | Исходные продуктовые решения #636 применяются |
| Hosting | `wrangler.jsonc`: `dist`, Worker ASSETS, SPA fallback; `/api/*` run_worker_first | HTML/JS и API зависят от Cloudflare, холодный старт проверять отдельно |
| Telegram SDK | `index.html`: `https://telegram.org/js/telegram-web-app.js` | Отдельный внешний bootstrap dependency, не покрывается warm Dexie sync |
| Custom auth | `database.ts` → fetchTokens → `getDexieCloudTokens` → `/api/dexie-cloud/tokens` | Недоступность Worker может блокировать выдачу/обновление credentials |
| Бизнес-записи | Локальная Dexie и Addon, без нового SyncEngine | Прототип не меняет обычный CRUD или grants |
| Контекст настроек владельца | Private bucket/SA/uploader подготовлены, ключи ещё не созданы | Signed upload требует разрешённого operator key; не просить секреты в чат |

## Реальные запросы из рабочего окружения агента

Это **не телефон, не Telegram, не российская сеть и не gateway runtime**.
Из них нельзя выводить no-VPN доступность или подтверждение ACL.

| Время UTC 2026-11-06 | Запрос | Ответ | Время | Граница результата |
| --- | --- | --- | --- | --- |
| 03:28:32 | GET `https://zjv60oxag.dexie.cloud/public/roles` без bearer | HTTP 200 | 7601 мс | Только public reachability из executor |
| 03:28:39 | GET `https://storage.yandexcloud.net/mezfit-comm-poc-20261106` без подписи | HTTP 403 | 7311 мс | Отказ на bucket-level request; не проверка приватности существующего объекта |

Содержимое ответов и credentials не сохранялись. Resource creation, подписи,
привилегированные writes и облачные деплои не выполнялись.

## Матрица обязательных испытаний

`NOT_RUN` = нет фактического результата; не FAIL и не PASS. В графе Evidence после опыта
указать deployment, ОС/Telegram, дату/сеть/VPN, безопасный отчёт и ручные наблюдения.

| Путь | iOS Telegram VPN OFF | Android Telegram VPN OFF | Evidence / что ещё нужно |
| --- | --- | --- | --- |
| Уже открыта → VPN OFF: чтение local + remote | NOT_RUN | NOT_RUN | Два аккаунта/телефона владельца |
| Обычная запись repository → Addon → второй разрешённый клиент | NOT_RUN | NOT_RUN | Метка тестового события и подтверждение на другом устройстве, не только local success |
| Warm reopen | NOT_RUN | NOT_RUN | Полное закрытие и возврат |
| Cold cache + HTML/JS/CSS/Telegram SDK | NOT_RUN | NOT_RUN | Чистый тестовый WebView без удаления несинхронизированных данных |
| Refresh/новая версия hosting | NOT_RUN | NOT_RUN | Подтверждённый deployment и новые hashes, не кеш |
| Реальное истечение access token и Addon refresh | NOT_RUN | NOT_RUN | Время/HTTP безопасных событий, не one-shot auth probe |
| Ошибки `/api/dexie-cloud/tokens` без VPN | NOT_RUN | NOT_RUN | HTTP/timeout/transport отдельно |
| Private signed PUT/HEAD/GET маленького файла | NOT_RUN | NOT_RUN | Одобренные короткие подписи, CORS точного origin |
| MP4 ≤3 мин без сжатия: upload/Range/play/seek | NOT_RUN | NOT_RUN | Несекретное MP4 и фактическое воспроизведение |
| Unsigned/expired/wrong-object/wrong-origin denial | NOT_RUN | NOT_RUN | Только коды; без URL/подписи в отчёте |
| Network interruption → recovery/retry | NOT_RUN | NOT_RUN | Отличать целый повтор PUT от multipart-resume |
| Background / lock / foreground + server receipt | NOT_RUN | NOT_RUN | continued-confirmed / resumed-after-return / retry-required / unknown |
| Phone → prospective gateway reachable | NOT_RUN | NOT_RUN | После одобренного размещения Function, ожидаемый HTTP 401/403 |

| Серверный эксперимент | Статус | Evidence |
| --- | --- | --- |
| Prospective Yandex gateway → Dexie public route | NOT_RUN | Нет одобренного gateway deployment |
| Тот же runtime → Dexie ordinary-account read | NOT_RUN | Нужен обычный scoped тестовый bearer через secret storage, не privileged key |
| Identity/realm/anchor media authorization | NOT_PROVEN | Сетевой probe намеренно не реализует production authorization; отдельный проверяемый контракт до COMM-09 |

## Go / no-go

**NO-GO** для заявления «COMM-02 принят», production media-PR и обязательной
Telegram-доставки на основании этого отчёта: нет реальных обязательных измерений.
Подготовка контракта/ревью может идти отдельно, но не превращает `NOT_RUN` в PASS.
Строгая фоновая загрузка пока **не подтверждена и не опровергнута**.

Следующие необходимые действия владельца:

1. Решение до открытия PR по audit-факторам A-006/A-008/A-010/A-012, перечисленным
   в runbook; комплект кода должен пройти review до этого решения.
2. Перед облачным опытом — Cloud ID / Folder ID, фактический origin Mini App и
   явное разрешение конкретного списка key/CORS/Function/стоимости из runbook §3.
   Не передавать secret values, пароли или private медиа в Work/issue.
3. Прогон iOS/Android с двумя тестовыми Telegram-аккаунтами по runbook §§4–7,
   safe reports и ручные результаты. До этого go/no-go не менять.
4. Если подтверждён Cloudflare/bootstrap blocker — рассмотреть зеркало static assets
   и доступный auth endpoint; выбрать вариант с владельцем, не переносить автоматически.

Результаты CI, когда они появятся после PR, не заменяют перечисленные измерения.

## Ревью подготовленного комплекта

После первого коммита просмотрены полный scope, новые transport/UI/gateway tests и
действующие CloudAuthDiagnostic/CloudSyncDiagnostic/CloudAvatarDiagnostic tests.
Старые тесты соответствуют неизменённым auth/sync/avatar сценариям и не правились.
В новом наборе есть проверки hostile tickets, HTTP/network/cancel, Range integrity,
первого явного действия, unmount cleanup и безопасного экспорта/серверных отказов.
Защитный пробел сохранения tickets внутри git исправлен; повторное ревью проверяет
фиксированный bucket/prefix, память без persistence и отсутствие секретов в результатах.

Выполнены только `git diff --check`, синтаксический разбор Node gateway/Python signer,
разбор CORS JSON и проверка относительных ссылок документации. **Локальные npm,
typecheck, тесты и build не запускались.** TypeScript и тестовые сценарии пока не
проверены исполнением; CI возможен после разрешённого открытия PR.

PR не открыт: ожидается решение владельца по перечисленным audit-факторам.
Облачные ресурсы/ключи/права не создавались и не менялись. Публикация ветки кода
для review не является разрешением на cloud/deploy/device acceptance.
