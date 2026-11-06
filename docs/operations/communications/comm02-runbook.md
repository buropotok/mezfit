# COMM-02: воспроизводимый опыт без VPN

Статус: комплект прототипа подготовлен; **доступность на телефонах ещё не доказана**.
Основание: [#637](https://github.com/buropotok/mezfit/issues/637),
[продуктовый контракт](../../architecture/communications.md).
[Таблица результатов и go/no-go](comm02-results.md) заполняется только после опыта.
Этот документ не разрешает автоматически ресурсы, credentials, grants или расходы.

## 1. Что подготовлено и что не меняется

Отдельная панель по существующей ссылке
[Проверка Dexie Cloud в Telegram](https://t.me/mezfit_bot?startapp=cloud_auth_check)
→ «Проверить сеть без VPN». Код панели загружается по явному нажатию.
Ничего не стартует автоматически, нет нового браузерного продукта, чат-таблиц,
SyncEngine, ACL/schema rollout или изменения PLAN/FACT. Панель не открывает бизнес-БД.
Авторизация и read-only sync доступны соседними кнопками прежней диагностики;
запись проверяется в обычном приложении через существующий repository (§4).

Транспортный модуль принадлежит diagnostics/communications, React передаёт только
намерения и отображает безопасные результаты. Подписи не попадают в clipboard report,
localStorage, IndexedDB, URL запуска, логи или бизнес-записи. При закрытии панели
запрос прерывается, listener/object URL освобождаются. Нативные file inputs скрыты,
видимые действия — публичные капсульные Konsta Button. Файлы не перекодируются.

## 2. Известные несекретные настройки

По переданному контексту настройки владельцем уже подготовлены:

| Параметр | Значение / состояние |
| --- | --- |
| Каталог | `mezfit-media` |
| Private test bucket | `mezfit-comm-poc-20261106` |
| Сервисный аккаунт | `mezfit-media-poc` |
| Роль | `storage.uploader` только на тестовый bucket |
| Регион / S3 endpoint | `ru-central1` / `https://storage.yandexcloud.net` |
| Budget alerts | `mezfit-test-budget`, 100 ₽/месяц, 25/50/80%; **уведомления не ограничивают расход** |
| Статический ключ | Пока не создавался |
| Cloud ID / Folder ID | Не переданы в текущую задачу; нужны для размещения Function |
| Реальный origin Mini App | Записать `location.origin` из безопасного отчёта; не угадывать по имени Worker |
| CORS / gateway URL / версия runtime | Не подтверждены; зафиксировать до опыта |

Роль uploader позволяет upload/read, но не управление bucket или удаление объектов.
Не добавлять admin или новые роли «для удобства». Очистку тестового префикса
`comm02/` выполняет владелец своими уже разрешёнными средствами после опыта.
Публичное чтение/listing и website hosting в bucket не включать.

## 3. Точки разрешения до облачных действий

Показать владельцу следующий конкретный объём и дождаться согласия:

1. В существующем SA создать временный S3 static access key для подписания только
   тестовых объектов (не расширяя bucket grant). Хранить в Lockbox либо скрытом
   вводе operator shell, не в Work/issue/PR. После опыта отозвать.
2. Применить `tools/communications/cors.example.json`, заменив placeholder на
   **точный** origin Mini App. Если нужен дополнительный origin, одобрить его отдельно.
   Без `*`, без DELETE; PUT/GET/HEAD, request headers content-type/range,
   exposed ETag/Content-Length/Content-Range/Accept-Ranges. CORS не даёт доступа
   к private объекту без подписи и не заменяет IAM.
3. Разместить `tools/communications/gateway-probe.mjs` как временную Function
   в выбранном каталоге: Node.js 22, ESM, entry `gateway-probe.handler`, один
   `package.json` с `{"type":"module"}` рядом с модулем. Это сетевой прототип,
   не production media authorization gateway. Не привязывать admin service account.
   Точный runtime проверить в Console перед созданием версии. Если нужен Lockbox
   accessor/invoker grant, перечислить точный ресурс/роль и получить согласие отдельно.
4. Function получает отдельный случайный `COMM02_PROBE_SECRET` (не менее 32 символов)
   и при наличии **обычный scoped read-only тестовый bearer** `COMM02_DEXIE_READ_TOKEN`.
   Это не `DEXIE_CLOUD_WRITE_KEY` и не cloud client secret. Секреты — скрытая настройка;
   не передавать через URL или shell arguments. Публичный invocation без IAM, если
   потребуется для сетевого опыта, также отдельно согласовать; handler требует
   свой secret и не проксирует клиентские URLs/данные.

Возможные расходы: storage объём/операции/исходящий трафик, Function вызовы/время,
секретное хранилище, logging. До создания записать текущие квоты и оценку для 2 телефонов,
двух 1-КиБ объектов и двух MP4 до 64 МиБ, повторов и нескольких Function вызовов.
Проверить [тарифы Storage](https://yandex.cloud/en/docs/storage/pricing),
[Functions](https://yandex.cloud/en/docs/functions/pricing),
[Lockbox](https://yandex.cloud/en/docs/lockbox/pricing).
Не считать бюджет 100 ₽ разрешением на новые платные ресурсы. При выходе за
подтверждённый бесплатный/одобренный предел остановиться до операции.

## 4. Два телефона и два Telegram-аккаунта

Владелец использует свои два тестовых аккаунта без передачи паролей. Нужны настоящий
Telegram Android и iOS, Россия, версии ОС/Telegram, дата, Wi-Fi/оператор и явно
зафиксированный VPN ON/OFF. Если фактического устройства нет — `NOT_RUN`, не PASS.

Для каждого телефона выполнить отдельно:

1. VPN ON: открыть обычный Mezfit и затем ссылку диагностики. Записать origin,
   дату/версию deployment и `comm02-20261106-1`. Убедиться, что IndexedDB уже гидратирован.
2. Не закрывая Mini App выключить VPN. В обычном приложении создать несекретное
   личное тестовое событие календаря с уникальной меткой и изменить только его описание.
   Записать мгновенное локальное сохранение отдельно от облачного подтверждения.
   На втором устройстве **того же аккаунта** проверить появление/изменение метки;
   если доступно лишь два разных аккаунта, использовать уже связанный тестовый realm
   и разрешённую им совместную операцию, не менять ACL ради опыта. После опыта
   удалить/отменить только собственное тестовое событие через обычный UX.
3. В диагностике: существующие «Проверить авторизацию» и «Проверить синхронизацию».
   Новый token exchange не равен refresh Addon. Не экспортировать Network HAR целиком.
   При ошибке записать только endpoint без query, HTTP code и этап.
4. Истечение токена: не менять часы, IndexedDB, JWT или fetch. В локальном Web Inspector
   наблюдать **реальный** вызов `/api/dexie-cloud/tokens` от Addon после естественного
   истечения access token; сохранять только время/HTTP status и последующий sync.
   Значение expiration можно прочитать локально, токен/headers/body никуда не копировать.
   Если refresh происходит другим подтверждённым путём, записать фактический endpoint
   и причину по Addon; не предполагать, что каждый refresh обязан вызвать Worker.
   Успех кнопки one-shot auth не закрывает этот пункт. Короткий тестовый срок токена
   требует отдельного согласования, production TTL не менять.
5. Warm reopen: полностью закрыть Telegram/Mini App и открыть без VPN с прежним кешем.
6. Cold cache: только после sync тестовых данных очистить web-cache Telegram для
   тестового запуска средствами Telegram/тестового устройства (не удалять рабочий
   IndexedDB без отдельного согласия), либо взять свежий тестовый WebView/устройство.
   Открыть без VPN. Записать HTML, `telegram.org/js/telegram-web-app.js`, hashed JS/CSS,
   fonts, API/Dexie host, ошибки DNS/TLS/CORS отдельно. Скрин 4 квадратиков/boot watchdog —
   FAIL/блокер, а не успех офлайн-оболочки. Не путать очистку кеша с выходом из аккаунта.
7. Новая версия: после отдельного согласованного deployment повторить no-VPN refresh,
   сравнить реальную версию/хеши ресурсов с новым deployment. Старый номер версии в
   кеше не доказывает загрузку обновления. Данная задача сама ничего не деплоит.
8. В панели нажать проверку HTML/JS: новые no-store запросы с nonce проверяют сеть
   текущего origin. Это **не** холодный старт и **не** проверка всех CSS/fonts/SDK.
   Проверку зависимостей из шага 6 не заменять результатом этой кнопки.

Если Worker assets/auth недоступны: предложенная минимальная альтернатива — зеркало
статического Vite dist на одобренном доступном из РФ hosting + доступный auth endpoint
с прежней серверной верификацией Telegram/Dexie identity. Это только кандидат:
проверить Telegram launch origin, CORS/CSP, cookies/origin storage, обновления и refresh;
не переключать URL бота, не переносить users/realms/IndexedDB и не мигрировать автоматически.
Одно зеркало файлов не исправляет недоступный Worker token exchange.

## 5. Private PUT / HEAD / GET / Range

После разрешений из §3 на доверенном **сервере/компьютере оператора** установить
официальный SDK в изолированное окружение: `python -m pip install 'boto3==1.40.0'`.
Это не зависимость приложения и не запуск npm. Секреты вводятся скрыто, не в аргументах:

```bash
read -r -s -p 'S3 key ID: ' AWS_ACCESS_KEY_ID
export AWS_ACCESS_KEY_ID
read -r -s -p 'S3 secret: ' AWS_SECRET_ACCESS_KEY
export AWS_SECRET_ACCESS_KEY
python tools/communications/presign.py --kind small --output /tmp/comm02-small-ticket.json
python tools/communications/presign.py --kind video --output /tmp/comm02-video-ticket.json
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
```

Скрипт не делает cloud writes: SDK локально подписывает PUT/GET/HEAD на новый UUID
в `comm02/`, срок 900 секунд. Сам PUT возможен только по явному действию владельца
на телефоне. Outputs — capability-файлы с mode 0600; не помещать их в git,
чат/issue/Library или общий каталог, не показывать их содержимое на скриншотах.
Передать на тестовый телефон приватным способом, открыть file picker диагностики
(не ссылку/сообщение боту); после опыта удалить tickets с телефона и компьютера.
Не открывать S3 secret на телефоне. Если безопасная доставка ticket недоступна,
остановить этот опыт до настройки одобренного gateway.

На каждом телефоне при VPN OFF:

1. Выбрать small ticket → «Проверить маленький файл»: синтетические 1024 байта,
   затем отдельные HEAD, GET, Range. PUT 2xx, HEAD 200/точный размер, GET 200/nonempty,
   Range 206/точный Content-Range/совпадение первых байт. CORS preflight смотреть
   локально; отсутствие видимого HTTP статуса в JS — `NETWORK_OR_CORS`, а не обязательно VPN.
2. Выбрать video ticket и несекретное MP4 до 180 секунд → upload/read проверки.
   64 МиБ — **бюджет диагностики** по памяти/трафику, не продуктовый лимит видео.
   Нет автосжатия. GET читает первый chunk и отменяет stream; Range сверяет первый КиБ,
   это не доказательство воспроизведения всего видео. Полное play/seek/длительность
   проверить на устройстве через private signed GET, не публикуя URL. Зафиксировать
   Content-Type, размер, Range при seek и отсутствие перекодирования.
3. Negative: на существующем тестовом объекте открыть URL **без подписи**, убедиться
   в отказе, не включать public read. После 900 секунд повторить чтение — ожидается
   отказ срока подписи. Подмена метода/объекта и неправильный origin должны дать отказ
   либо CORS-блокировку. Не экспортировать XML/URL; записать только статусы.
4. Сымитировать обрыв сети во время PUT → возврат сети → явный повтор той же операции
   с ещё действующим ticket. Проверить размер/Range после успешного повтора.
   Этот harness повторяет PUT целиком, **не** поддерживает multipart/byte-resume;
   не помечать «resumable upload» как PASS. Если сеть/expiry мешает, получить новый
   ticket; это новый тестовый объект, старый проверить и убрать при cleanup.

## 6. Фон / возврат

Отдельные прогоны MP4: (а) всё время foreground; (б) свернуть Telegram на 30–60 секунд;
(в) блокировка телефона; (г) обрыв сети + возврат. Зафиксировать часы устройства и
серверную LastModified/наличие **завершённого** объекта, пока Telegram ещё в фоне,
с разрешённой Console/HEAD со второго устройства. Client progress — не серверный receipt.
При необходимости ограничить скорость тестовой сети, чтобы файл не успел уйти до сворачивания.

В отчёте события visibility/progress/complete, время и флаг hidden; максимум 200 событий,
`omittedEvents` показывает отброшенные. События могут прийти лишь после resume.
Различать: `continued-confirmed` (серверное доказательство), `resumed-after-return`,
`retry-required`, `unknown`. Таймеры WebView могут быть приостановлены, относительные
наблюдения клиента не являются гарантией непрерывности. Подтверждённое ограничение
строгого background — blocker, владелец выбирает допустимый UX; требование не менять молча.

## 7. Gateway → Dexie server-to-server

После согласованного размещения временной Function вызвать её именно из будущего
gateway runtime, не выдавать desktop curl/Cloud Shell за идентичную сетевую среду.
Вызов — POST с Bearer `COMM02_PROBE_SECRET` через скрытый ввод/приватный инструмент;
не использовать `curl -v`, query token, HAR и печать request headers.
Без secret ответ 401 (либо IAM 403 до handler); не-POST с верным secret — 405;
нет конфигурации/обычного token — 503; upstream HTTP/network — 502, timeout — 504.
Тело — только безопасные коды/статусы двух фиксированных GET:
`/public/roles` без bearer и `/all/realms` с обычным scoped bearer.
Отдельно проверить браузер/телефон при VPN OFF получает ожидаемый 401 от Function:
это подтверждает сетевую доступность endpoint, не авторизацию медиа.

Доступный public route не закрывает authenticated route. Даже два 200 доказывают
только сетевую достижимость read-запросов. Не доказаны: Telegram auth из gateway,
обновление Dexie token, запрет чужого realm/anchor, production signing. Эти пункты
нуждаются в отдельном прототипе авторизации/отрицательных проверках до COMM-09;
результат `authorizationDesignProven: false` намеренно не позволяет объявить их готовыми.
Никаких новых privileged Dexie credentials или grants для этого опыта.

## 8. Приёмка, audit и передача

Заполнить таблицу результатов на каждую ОС/сеть, приложить safe report без signed URLs,
указать ручные наблюдения и точную версию. `NOT_RUN` не PASS, no-VPN не выводится из
`navigator.onLine`. До подтверждения обязательных путей — **NO-GO** соответствующим этапам.
При cloud auth/hosting blocker — решение владельца, а не самостоятельная миграция.

Перед PR: commit, системное review AGENTS/контракт/audit, source review старых и новых
тестов, исправление/commit/review. Локальные npm/typecheck/test/build не запускать.
Релевантные факторы аудита для решения владельца до PR:
**A-010** (runtime HTTP данные: validator ticket, content-type/status/range и исключение секретов
из результатов), **A-008/A-012** (UI-примитивы: штатные Konsta capsule buttons,
без private CSS/DOM), **A-006** (bootstrap: диагностируется on demand, запуск не меняется).
Это карта риска, не утверждение о наличии перечисленных дефектов в новом коде.

Источники: [Yandex presigned upload](https://yandex.cloud/en/docs/storage/operations/objects/link-for-upload),
[CORS](https://yandex.cloud/en/docs/storage/operations/buckets/cors),
[Storage permissions](https://yandex.cloud/en/docs/storage/security/),
[Telegram Mini Apps](https://core.telegram.org/bots/webapps),
[Dexie fetchTokens](https://dexie.org/docs/cloud/db.cloud.configure()).
