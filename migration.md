# Migration — архитектура, техническая концепция и дорожная карта

**Проект:** Mezfit · **Репозиторий:** `buropotok/mezfit`  
**Дата фиксации контекста:** 17 ноября 2026 г.  
**Статус:** архитектурный документ / ориентир для следующих этапов, **не** свидетельство реализации запланированного кода.  
**Текущая точка:** инфраструктура и TypeScript File Processing Engine v1 приняты в Cloudflare на synthetic fixture. В MIG-03 реализованы общий Adapter Engine и два синтетических адаптера. Облачная проверка новой реализации ожидается. [Инструкция запуска](docs/architecture/migration-infrastructure.md#проверка-typescript-execution-engine).

> **Назначение.** Это основной документ для нового рабочего чата, архитектора и разработчика, продолжающего миграцию из Gym Keeper в Mezfit. Здесь зафиксированы задача, принятые решения, границы системы, подтверждённые результаты, ещё не реализованные контракты, риски, этапы, порядок приёмки и источники. Тексты поручений агентам сюда намеренно не включены.

## 1. Цель и ожидаемый продукт

Mezfit — система «тренер — клиент», в которой тренер составляет программу (PLAN), назначает тренировки, а выполнение и история (FACT) имеют отдельную модель. Gym Keeper — локальный Android-дневник тренировок. Его модель нельзя механически переносить в Mezfit: исходная программа, запланированная тренировка и выполненная тренировка — разные сущности с разной семантикой доступа и жизненного цикла.

**Продуктовая цель миграции:** универсальный импортёр с проверяемыми адаптерами источников. Gym Keeper — первый предполагаемый реальный источник. Тренер получает контролируемый путь переноса программ, дневников и исторических результатов с предварительной проверкой, точным отчётом о пропусках и ошибках, сохранением исходника и границ Coach/Client. Новый формат подключается адаптером, сохраняя общий Import Engine.

Целевой путь (с разделением технической подготовки и бизнес-публикации):

~~~text
Файл поддерживаемого источника / экспорт пользователя
           │
           ▼
Приватная загрузка в Cloudflare R2
           │
           ▼
Проверка, регистрация, ограниченное чтение
           │
           ▼
Детерминированный dispatcher + registry
           │
           ▼
Проверенный адаптер формата/версии
           │
           ▼
Версионированный транспортный результат
           │
           ▼
Бизнес-канонизация Mezfit (будущий этап)
           │
           ▼
Предпросмотр + выбор пользователя + проверка прав
           │
           ▼
Контролируемая публикация через одобренный доменный путь
           │
           ▼
Dexie Cloud (единственная авторитетная бизнес-БД)
~~~

Загрузка, регистрация и техническая обработка **не дают полномочий** на публикацию клиентских данных. Успешное завершение технического Workflow не равно успешному импорту в доменную модель.

### Основные принципы

1. Сохранять исходный файл неизменным; преобразования и результаты — отдельные версионированные объекты.
2. Запрещать «угадывающий» импорт: неизвестный формат или неподтверждённое поле обозначать явно.
3. Разделять доказанное наблюдение из APK, гипотезу о формате и утверждённое решение Mezfit.
4. Разделять технические статусы в D1 и бизнес-данные в Dexie Cloud.
5. Обеспечивать идемпотентность, восстановление после частичного отказа и проверяемость каждого перехода.
6. Сквозная безопасная диагностика — обязательное свойство каждого этапа.
7. Не добавлять платную вычислительную инфраструктуру без отдельного решения владельца.
8. Реализовывать согласованные независимые вертикальные этапы, каждый со своим проверяемым результатом.

## 2. Статус и что действительно подтверждено

### 2.1. Реализовано и проверено (этап 1)

Развёрнута отдельная миграционная инфраструктура Cloudflare:

| Сущность | Имя / назначение | Подтверждённый статус |
| --- | --- | --- |
| Worker | `mezfit-migration` — Queue consumer и Workflow entrypoint | Развёрнут |
| R2 bucket | `mezfit-migration-uploads` — приватный приём файлов и технические трассы | Проверен |
| Queue | `mezfit-migration-events` — R2 object-create и smoke replay | Проверена |
| D1 | `mezfit-migration-jobs` — технические задания, replay receipts | Проверена |
| Workflow | `mezfit-migration-workflow` — инфраструктурная оркестрация/smoke | Проверен |
| GitHub Actions | Bootstrap, Deploy, Diagnose / smoke | Используются |
| Observability | Структурированные события и резервные следы в приватном R2 | Работает с оговоркой ниже |

**Доказательство:** независимый GitHub Actions run  
https://github.com/buropotok/mezfit/actions/runs/44094545908

Результат: **`MIGRATION_SMOKE_OK`**, успешный job `smoke`. Обработчик выполнялся с Worker version **`0e975b73-6e7b-4f4e-8e64-c906643f9903`**. Проверены подписанная загрузка, R2 HEAD, доставка R2 event через Queue, запись и replay в D1, негативные проверки SigV4, запрет перезаписи и анонимного чтения, удаление синтетических объектов.

Это свидетельство **работоспособности инфраструктурного маршрута на том запуске**, но не доказательство поддержки Gym Keeper, TypeScript Processor или будущего импорта.

Действующий основной Worker приложения `mezfit` — **отдельный** от `mezfit-migration`. Его Telegram API, авторизацию и media integration не модифицировать в рамках инфраструктурного или processor-этапа.

### 2.2. Выявленные проблемы и известные наблюдения

- Предыдущие независимые smoke запускались неудачно:  
  https://github.com/buropotok/mezfit/actions/runs/44073200671  
  https://github.com/buropotok/mezfit/actions/runs/44090366231  
  https://github.com/buropotok/mezfit/actions/runs/44092821599
- Сбой проверки подписи был устранён без принятия произвольного HTTP 403 за истечение срока: использована контролируемая проверка истечения.
- S3 endpoint Cloudflare R2 на анонимный GET вернул `HTTP 400 InvalidArgument` с корректным S3 XML. Проверка стала учитывать именно эту безопасную комбинацию; она **не** считает любой HTTP 400 свидетельством закрытого бакета. Приватность bucket также читается из его Cloudflare-конфигурации.
- После deploy новый Workflow однажды начал исполнять **предыдущую версию** Worker, хотя публикация новой версии уже завершилась. В одном неудачном запуске основной smoke исполнялся на `93943e1e-eb74-46d0-a4ef-cef6e7dc57a1`, а последующий cleanup — уже на `0e975b73-6e7b-4f4e-8e64-c906643f9903`. Повторный независимый smoke на новой версии прошёл. Перед processor smoke используется проверка версии, исполняемой самим Workflow.
- Workers Telemetry/Observability API возвращал **HTTP 403** для чтения логов при доступной частичной диагностике. Полная трасса восстанавливалась из приватного R2; отчёт обоснованно маркировался `Collection: PARTIAL`. Не выдавать это за полностью исправленную Observability и не расширять API token без согласования.
- Прямой individual publisher receipt для конкретного R2 Event Notification в имеющемся API не всегда доступен. Наличие rule и агрегатных Queue metrics — не доказательство события по конкретному объекту; следствия в consumer/D1 можно подтверждать независимо.

### 2.3. Состояние этапа 2 и последующих этапов

| Возможность | Статус на дату документа |
| --- | --- |
| TypeScript File Processor | **Done для synthetic v1, cloud run 44156101755** |
| Операция Workflow `process` | **Done, подтверждён сквозной synthetic pipeline** |
| Таблица технических `migration_executions` | **0003 применена, execution/replay/cleanup проверены** |
| R2 JSON result write/readback для processor | **Done для v1, SHA-256/readback подтверждены** |
| `MIGRATION_PROCESSOR_SMOKE_OK` | **Получен в независимом run 44156101755** |
| MIG-03 Adapter Engine / registry / два synthetic adapters | **Код реализован, CI и облачная проверка новой функциональности ожидаются** |
| AI Discovery / AI Adapter Builder | **Planned, только типизированная граница кандидатов** |
| Чтение реального Gym Keeper `.dbi` | **Формат не подтверждён** |
| Импорт Program / Diary JSON | **Схема образца не подтверждена** |
| Нормализация в модель Mezfit | **Будущий этап** |
| Безопасная публикация в Dexie Cloud | **Будущее отдельное архитектурное решение** |
| Пользовательский экран импорта | **Будущий этап** |

Новые рабочие чаты должны сверять эту таблицу с текущим `main` и последними успешными cloud-run. Наличие описания в этом файле само по себе не означает готовой реализации.

### 2.4. Подтверждённая облачная приёмка этапа 2

Повторно прочитаны статусы jobs и логи следующих запусков от 17 ноября 2026 г.

| Проверка | Run | Подтверждение |
| --- | --- | --- |
| Deploy migration Worker | [44152635983](https://github.com/buropotok/mezfit/actions/runs/44152635983) | SUCCESS, D1 migrations применены до deploy, `MIGRATION_SMOKE_OK` |
| Независимый infra smoke | [44153088455](https://github.com/buropotok/mezfit/actions/runs/44153088455) | SUCCESS, `MIGRATION_SMOKE_OK` |
| Независимый processor smoke | [44156101755](https://github.com/buropotok/mezfit/actions/runs/44156101755) | SUCCESS, `MIGRATION_PROCESSOR_SMOKE_OK` |

Processor smoke исполнялся для source SHA `35b6bc807c21b7a28fe6e1114b7c211bf5f6cd4f`,
Worker version `7346d11b-8587-460b-947e-cfea9e978fd0`, processor `v1`,
trace ID `a4b0bfad-ebb2-46bc-8e1e-d293051ce54d`.
Подтверждены 256 записей при входе 8192 байта, результат 281 байт,
R2 → Queue → D1 → Workflow → processing → R2 result/checksum → D1,
replay/idempotency и cleanup. В readback все три технические таблицы пусты,
вход и результат отсутствуют.

Отчёт содержит `Smoke result: OK` и `Collection: PARTIAL`.
Пробелы — `workers_logs: permission-denied`, `invocation_cpu: unavailable`,
`r2-per-object-publisher-receipt: unavailable`. Фактический CPU budget этим
прогоном не измерен. Эти свидетельства относятся к synthetic pipeline v1 до
MIG-03. Реальный Gym Keeper, AI, бизнес-импорт и новая adapter-функциональность
требуют собственной проверки.

## 3. Доказательная база Gym Keeper и неизвестные форматы

Основной источник: [`docs/reference/gym-keeper/backup-format.md`](docs/reference/gym-keeper/backup-format.md), а также [`program-diary-domain.md`](docs/reference/gym-keeper/program-diary-domain.md) и [`final-synthesis.md`](docs/reference/gym-keeper/final-synthesis.md).

### 3.1. Непосредственно обнаружено в APK

Существуют **минимум две категории обмена данными**, которые нельзя приравнивать друг к другу:

1. **Полный Backup / Restore**: строки `gymkeeper_backup.`, `gymkeeper_backup_reserve.`, `BACKUP`, восстановление локального файла, Google Drive backup, а также Realm API `writeCopy` / `nativeWriteCopy` / `writeCopyTo`. Анализ модулей также выявил упоминание `.dbi`.
2. **Логический импорт/экспорт Program и Diary**: `export_diary`, `export_program`, `import_diary`, `import_program`, `importProgramOrDiary`, строки `.json`, `application/json`.

Статический APK подтверждает наличие механизмов и части модели (`Diary`, `Program`, `Day`, `Workout`, `Exercise`, `Set`), но **не** устанавливает байтовую схему резервной копии или точную JSON-сериализацию.

### 3.2. Гипотезы — не установленные факты

- Full backup **может** быть копией Realm DB, контейнером, сжатием или иным форматом; точный формат `.dbi` неизвестен.
- Program/Diary export **вероятно** сериализует логические объекты в JSON, но корневые поля, связи, версии и единицы измерения требуют образца.
- Структура Gym Keeper ≈ `Diary → Day → Workout → Exercise → Set` — полезная реконструкция, а не целевая схема Mezfit.

**Не допускается:** выдумывать `.dbi` decoder, воспринимать любой JSON как экспорт Gym Keeper, молча присваивать несуществующие поля, загружать неподтверждённый binary parser в production.

### 3.3. Минимальные входные доказательства для настоящего адаптера

Нужны три реально экспортированных и обезличенных файла одной известной версии приложения:

1. Полный локальный backup (`.dbi` или фактическое расширение).
2. Экспорт одного Diary.
3. Экспорт одного Program.

Рекомендуемый синтетический тестовый дневник: одно стандартное и одно пользовательское упражнение, разные типы подходов, один superset, тренировка и дата, комментарий, измерение тела и необязательное фото. Для каждого образца нужны описание способа экспорта, версия приложения, контрольная сумма и согласие на анализ. Не коммитить реальные персональные данные в репозиторий.

Перед реализацией decoder подтвердить: magic bytes/envelope, расширение, gzip/zip/Realm, версии, корневые JSON-поля, ID/reference semantics, timestamps/timezone, units, связи, multiple diaries, настройки и медиа.

## 4. Архитектурные инварианты Mezfit

**Единственная авторитетная бизнес-БД — Dexie Cloud.** Техническая D1 миграции не становится второй базой клиентов, программ или тренировок.

~~~text
Приложение Coach/Client
      ↓
Типизированные application/domain repositories
      ↓
Dexie.js + IndexedDB (локальный рабочий subset)
      ↕
Dexie Cloud Addon
      ↕
Dexie Cloud (авторитетная бизнес-БД, realm ACL)

Привилегированные действия → проверенный backend/Worker
                                   ↑
                        отдельная процедура импорта
~~~

Нормальное чтение/редактирование доменных данных идёт через local-first repos. Не создавать второй SyncEngine, прямой массовый бизнес-CRUD через миграционную D1 или неавторизованный сервис публикации.

**PLAN / FACT:** исходные программы и назначения тренера, плановые occurrences и фактические sessions не смешиваются; принятый snapshot тренировки/история должны сохранять семантику и не меняться задним числом после редактирования PLAN. Исторические импортированные результаты не должны случайно превращаться в активные задания клиенту.

**Realm boundaries:** personal realm, coach-only data, shared realm **на каждую связь coach-client**, public catalog. Клиент не получает доступ к другим отношениям, чужому каталогу тренера или чужим данным. Импорт обязан доказать актор, принадлежность выбранной цели и допустимость операции на сервере. Данные одного Diary не связывать автоматически с клиентом по имени.

**Идентификаторы:** канонические стабильные строковые ID, явные карты legacy ID → canonical ID и ссылки; никакого пересечения между клиентами и автоматического присвоения глобальных ID из исходного файла. Сохранять provenance source ID/format/version для диагностики, не делая их публичными business IDs.

**Политика исходных данных:** импорт — явная опциональная функция переноса, **не** повторение Android `Backup/Restore`/Google Drive UX. Встроенные программы Gym Keeper не переносить в client mode и не путать с программой, назначенной тренером.

См. [`docs/architecture/local-first-storage-sync.md`](docs/architecture/local-first-storage-sync.md) и `AGENTS.md`. При конфликте общей схемы из старых reference-заметок с этими документами приоритет у действующего local-first контракта. Например, устаревшее указание «Mezfit domain + D1/R2» в reference должно интерпретироваться только как технический pipeline; авторитетные доменные данные не хранятся в migration D1.

## 5. Текущая техническая реализация — точки расширения

| Файл/ресурс | Текущая роль | Будущее расширение |
| --- | --- | --- |
| `migration/worker/index.ts` | Queue entrypoint и операции Workflow, включая `process` и processor smoke/cleanup | Сохранять единый orchestration path |
| `migration/worker/events.ts` | Проверка события, регистрация и идемпотентный dispatch execution; `ack/retry` | Независим от формата файла |
| `migration/worker/processor/` | Контракт, registry, dispatcher, fixture/nested adapters, result codec | Новый формат через явную регистрацию и тесты |
| `migration/worker/r2-upload.ts` | SigV4 и формат upload keys | Без изменения контракта подписанной загрузки |
| `migration/worker/smoke.ts` | Инфраструктурный end-to-end smoke | Сохранить без регрессий |
| `migration/trace.mjs` | Общий schema/sanitizer событий | Добавить безопасные поля нового processor |
| `migration/worker/trace.ts` | Сбор/резервирование trace | Поддержать техоперации processor |
| `migration/trace-collector.mjs` | Корреляция логов из нескольких источников | Покрытие `process`, D1, R2 result |
| `migration/cloudflare.mjs` | Cloudflare API, bootstrap/deploy/diagnose, trace | Проверка готовности версии и новый smoke |
| `migration/wrangler.json` | Только приватный Worker, bindings и observability | Не создавать Container |
| `migration/d1/0001_create_migration_jobs.sql` | Техническая регистрация upload, states `uploaded/rejected` | Не менять старую семантику |
| `migration/d1/0002_create_migration_smoke_replays.sql` | Exact replay receipt | Не смешивать с бизнес-импортом |
| `migration/d1/0003_create_migration_executions.sql` | Технический execution, job/version uniqueness и terminal state | Применена в Cloudflare, MIG-03 не требует новой схемы |
| `.github/workflows/migration-deploy.yml` | Deploy и действующий smoke | Readiness gate + processor smoke по готовности |
| `.github/workflows/migration-smoke.yml` | `diagnose` / `smoke` / `processor-smoke` | Независимые проверки фактически развёрнутой версии |

Инфраструктурные endpoints Worker сейчас приватные: `workers_dev=false`, `preview_urls=false`, публичный обработчик `fetch` для них не настроен. Подписанный upload helper предназначен для будущей авторизованной интеграции, а не является уже опубликованным API для пользователя.

### 5.1. Состояния регистрации файла

Сейчас `migration_jobs` имеет только `uploaded` и `rejected`. Изменение исходного статуса при повторной Queue-доставке не должно превращаться в отдельную регистрацию, а действующая политика увеличения `deliveries` не должна приводить к запуску нескольких бизнес-исполнений.

Таблица обработки `migration_executions` **отдельная**: регистрация объекта и результат его разбора имеют разные жизненные циклы.

### 5.2. R2 namespace и фильтрация событий

Действующие префиксы и правила:

| Prefix | Назначение | Автоматический production process |
| --- | --- | --- |
| `uploads/<uuid>` | Входные файлы | Да, после проверки регистрации |
| `smoke/<uuid>` | Синтетический инфраструктурный smoke | Нет |
| `results/<job-id>/<processor-version>/result.json` | Технический JSON-результат | Нет |
| `_migration-traces/...` | Санитизированная диагностика | Нет |

Consumer явно пропускает trace, results и expiry-control smoke. Запись результата в тот же bucket не создаёт рекурсивную задачу.

## 6. Принятое решение по вычислениям: TypeScript на Workers Free

Выбрана реализация в существующем TypeScript Worker. **Python, Containers, Sandbox SDK, Docker, отдельный VPS и GitHub-hosted production execution не входят в текущую архитектуру.** Это решение принято из-за желания остаться на бесплатном тарифе Cloudflare и сохранить минимальное число инфраструктурных компонентов.

Платный Container **не является обязательной предпосылкой** для создания простого обработчика. Python Workers сами по себе возможны, но для данного репозитория TypeScript предпочтительнее: единый runtime, reuse типов, тестов, tracing и bindings.

**Ограничения Workers Free на дату проверки:** 10 мс CPU на вызов/step и 128 МБ памяти изолята; в Cloudflare Workflows длительное ожидание I/O не устраняет CPU limit. 100 MiB — действующий лимит **загрузки**, а не обещание 100 MiB глубокой обработки.

Официальные источники для повторной проверки перед разработкой:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workflows/reference/limits/
- https://developers.cloudflare.com/workflows/reference/pricing/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

### 6.1. Практическая стратегия

- Первый реальный processor — **детерминированный небольшого размера synthetic JSON fixture**. Он проверяет путь «прочитать байты → определить формат → валидировать → вычислить SHA-256 → выдать JSON → сохранить».
- Чтение R2 — ограниченное; использовать Stream/Range, когда их контракт оправдан. Не читать 100 MiB в один `arrayBuffer()`.
- Для больших форматов — **явно bounded и resumable** обработка: chunk/range, checkpoint, лимиты шагов, детерминированные операции. Переход к chunking возможен **только** после измерений CPU, памяти, числа шагов и понятного алгоритма формата.
- Нельзя без проверки считать, что потоковый I/O автоматически означает дешёвый CPU: декомпрессия, парсинг Realm, hashing и JSON.parse требуют CPU/памяти.
- При неподдерживаемом размере/формате — предсказуемый `unsupported` / контролируемый отказ, а не ложный успех.
- Отдельный переход на платные вычисления, если необходимые реальные файлы систематически не вписываются в Free, требует согласованного продуктового решения.

### 6.2. Изоляция процессора от Cloudflare

Ориентир: `migration/worker/processor/` с модулями определения формата, чтения, валидации, трансформации и схемы результата. Это действующий каталог pure processing, включая registry и адаптеры MIG-03.

Алгоритм должен принимать проверенный поток/ограниченный byte source и технические метаданные. Сам processor не управляет Queue, D1, R2, правами доступа или GitHub Actions; этими действиями владеют orchestration/adapters. Вся обработка должна быть детерминированной, без выполнения кода пользователя.

## 7. Целевой Execution Engine (этап 2)

### 7.1. Последовательность

~~~text
R2 Put (uploads/<uuid>)
  → Notification
  → Queue consumer validates envelope + HEAD
  → migration_jobs confirms registered input
  → lookup/create technical execution (idempotent)
  → confirm Workflow process instance (same deterministic identity)
  → Workflow reads execution + verifies exact source HEAD
  → bounded TypeScript processor (synthetic fixture initially)
  → validate result schema and size
  → R2 results/<id>/<processor-version>/result.json
  → verify R2 readback + digest
  → commit succeeded / unsupported / failed in D1
  → final report + private trace + cleanup
~~~

Граница Queue acknowledgment: `ack` только после подтверждённой безопасной регистрации/запуска или допустимого идемпотентного результата. Если ответ на Workflow create потерян, проверить существование **того же** instance ID, а не создавать новый. Временный отказ — ограниченный `retry`; некорректное событие — явное безопасное отклонение по установленному контракту.

### 7.2. Техническая запись выполнения

Действующая D1 migration `0003_create_migration_executions.sql` создала `migration_executions`.

Поля/инварианты действующего D1-контракта:

| Поле | Значение |
| --- | --- |
| `job_id`, `object_key` | Ссылка на зарегистрированный исходный upload |
| `object_etag`, `migration_jobs.object_size` | Контрольный снимок исходного объекта |
| `processor_version` | Версия алгоритма; часть уникального ключа идемпотентности |
| `workflow_id` | Детерминированная корреляция |
| `state` | `queued / running / succeeded / failed / unsupported` |
| `attempts` | Число принятых переходов в running, step retries видны отдельно в trace |
| `result_key`, `result_sha256` | Подтверждённый результат |
| `error_code` | Безопасная машинная причина |
| `created_at / updated_at` | Диагностика; отдельные started/finished timestamps не добавлялись |

Нужна уникальность для пары «зарегистрированный объект + версия процессора», CAS-подобные условные переходы в D1 и readback после записи. Повтор `succeeded` никогда не возвращает запись в `running`. Не менять `migration_jobs.state` ради этих состояний.

#### Состояния

~~~text
                ┌──────────────┐
                │    queued    │
                └──────┬───────┘
                       ▼
                  running
                /    |      \
               ▼     ▼       ▼
          succeeded failed unsupported
             (terminal по текущей версии processor)
~~~

Retries и recoveries должны уточняться явно: transient failures не обязаны немедленно переводить запись в terminal `failed`, если допустима повторная попытка. Для terminal записей нужен осмысленный новый processor version или отдельный операторский retry-contract, не неявный сброс.

### 7.3. Processor output

Действующий fixture сохраняет точную восьмиполевую схему v1 — `status`,
`schemaVersion: 1`, `processorVersion: v1`, `detectedFormat`,
`inputSizeBytes`, `inputSha256`, `summary`, `warnings`.
`summary.recordsValidated` и `warningsCount: 0` совместимы с live smoke.
Вывод fixture остаётся побайтово детерминированным при прежнем входе.

Для новых адаптеров schema v2 сохраняет общие поля и добавляет
`adapter: { id, version }` и `normalized`. NormalizedPayload — транспортные
коллекции записей со скалярными значениями; точные поля и ссылки проверяет
зарегистрированный адаптер. Это граница synthetic transport, бизнес-схема
PLAN/FACT и таблицы Dexie ещё требуют отдельного решения.
Общий `isResult` проверяет схему, provenance, зарегистрированную версию,
счётчики, warnings и adapter-specific payload на runtime boundary.

Вход ограничен **8192 байтами**, fixture — **256 records**, результат —
**1024 байтами**, включая provenance и payload. При превышении результата
возвращается `RESULT_SIZE_LIMIT`, без обрезания или успешного пустого результата.
R2 result key сохраняется `results/<job-id>/v1/result.json`.
После conditional PUT выполняются HEAD/readback и SHA-256 до D1 succeeded.

`PROCESSOR_VERSION=v1` сохранена ради совместимого fixture и текущих ключей
execution/idempotency. Новые результаты имеют schemaVersion 2 и явную версию
адаптера. Изменение семантики уже выпущенного адаптера требует осознанной версии
процессора и стратегии повторной обработки. Уже terminal execution не
перезапускается после добавления адаптера; операторский recovery отдельный.

### 7.4. Частичные сбои

| Сбой | Обязательная стратегия |
| --- | --- |
| Queue duplicate | Не запускать второй независимый execution; сохранить существующую регистрацию |
| Потерянный ответ Workflow create | Проверить тот же instance ID; не дублировать операцию |
| R2 HEAD/GET временно недоступен | Ограниченный retry; не подтверждать ложный успех |
| Вход изменился после регистрации | `INPUT_MISMATCH` / integrity failure; не обрабатывать другое содержимое |
| Неизвестный format | `UNSUPPORTED_FORMAT`, без бездумных повторов |
| Processor CPU/memory exceeded | Зафиксировать доступный технический сигнал; не пытаться записать фиктивный результат |
| R2 PUT завершился, ответ потерян | Проверить уже существующий output key, содержимое/хеш; при совпадении reconcile |
| Existing result имеет другой digest | Conflict, без перезаписи |
| R2 OK, D1 final write failed | Повторить только D1/readback при целостном output |
| Cleanup failure | Отдельное событие; не скрывать исходную ошибку |
| Logs API 403 | Продолжить сбор истории Workflow и приватной R2 трассы; отметить PARTIAL |

На первых этапах не требуется придумывать универсальную distributed transaction между R2 и D1: правильные стабильные ключи, ordering, conditional writes, readback и reconciliation дают восстановление.

### 7.5. Ready/version gate

После `wrangler deploy` версия **фактически выполняемого** Workflow может некоторое время отличаться от версии опубликованного Worker.

При запуске нового processor smoke или первом применении новой версии:

1. Получить ожидаемый commit SHA, deployed Worker version ID и processor version.
2. Проверить фактическую версию исполняющегося контрольного Workflow.
3. Сравнить с ожидаемой версией, а не с одной строкой `Successfully deployed`.
4. Ограниченно повторять проверку; при отсутствии готовности выдать `DEPLOYED_VERSION_NOT_READY`.
5. Не начинать интеграционный smoke на старой версии; фиксированный `sleep` без проверки **не** считается решением.

Исторический `versionId` из Cloudflare Workflow history и runtime `MIGRATION_VERSION.id` могут описывать разные уровни версии; сравнивать нужно корректные поля, а не любые встреченные UUID.

### 7.6. Универсальный Adapter Engine — MIG-03

Владельцы — `processor/contracts.ts`, `registry.ts`, `index.ts` и
`adapters/*.ts`. Общий dispatcher проверяет byte limit, JSON encoding/syntax,
передаёт адаптерам bounded bytes и разобранный JSON, определяет адаптер, вызывает parse/validate/normalize и строит общий результат. Для не-JSON сигнатур будущий проверенный decoder получает те же ограниченные bytes через AdapterInput.
Имя файла, MIME и job/user ID не участвуют в выборе. Workflow и D1/R2 получают
один контракт независимо от источника. Адаптеры работают без I/O.

Manifest содержит стабильный adapterId, semver адаптера, format/family,
пределы, detection (JSON marker или byte signature) и resultSchemaVersion. Registry принимает только явно
импортированный reviewed-код, хранит неизменяемый snapshot и ограничен 16
адаптерами. Один adapterId имеет одну активную версию в registry.
Распознавание выполняется по ограниченному содержимому, затем отдельно
проверяется схема. Порядок регистрации не определяет победителя.

| Ситуация | Результат |
| --- | --- |
| Нет совпадений | typed unsupported / `UNSUPPORTED_FORMAT` |
| Известная family, другая версия | typed unsupported / `UNSUPPORTED_FORMAT_VERSION` |
| Более одного точного совпадения | failed / `AMBIGUOUS_FORMAT` |
| JSON-looking input с неверным UTF-8 / синтаксисом | `INVALID_INPUT_ENCODING` / `INVALID_INPUT_JSON` |
| Распознанный формат, неверная схема | failed / `INVALID_INPUT_SCHEMA`, без fallback |
| Дубли ID / отсутствующие ссылки | `DUPLICATE_SOURCE_ID` / `DANGLING_REFERENCE` |
| Нарушен adapter record limit | `ADAPTER_RECORD_LIMIT` |

Fixture adapter сохраняет `mezfit-migration-fixture-v1` и `records[{value}]`.
Nested adapter принимает только synthetic `mezfit-migration-nested-v1`.

~~~json
{
  "format": "mezfit-migration-nested-v1",
  "container": {
    "groups": [
      {"sourceId": "g", "items": [
        {"sourceId": "a", "amount": 7, "peerId": null}
      ]}
    ]
  }
}
~~~

У nested не более 8 groups и суммарно 8 items. Source IDs уникальны между
обоими типами, состоят из 1–32 ASCII букв/цифр/underscore/hyphen.
Amount — safe integer, peerId — null или ссылка на item в любой группе,
включая forward reference. Все поля обязательны, дополнительные запрещены.
Выход — `normalized.groups[{id}]` и `items[{id,group,value,ref}]`, сортировка
по source ID, без locale-зависимости. Пустой container допустим, наличие
пустой группы даёт агрегированный `EMPTY_GROUP`. При длинных ID даже
допустимые 8 items могут не вместиться в 1024 байта; такой файл получает
явный `RESULT_SIZE_LIMIT`. Значения не обрезаются.

Добавление формата требует reviewed adapter с detect/parse/validate,
регистрации в `createProcessor([...])` и независимых тестов.
Инфраструктурный control-flow расширять условием по источнику не требуется.
Тестовая матрица меняет IDs, значения, объёмы и порядок, включает регистрацию
третьего тестового адаптера, конфликт детекции, неизвестные данные и версии,
нарушенные связи, codec mutation и общий Workflow path. Synthetic payload
не свидетельствует о поддержке Gym Keeper.

### 7.7. Будущие AI Discovery / AI Adapter Builder

При unsupported вызывающий слой позднее сможет сформировать
`AdapterDiscoveryRequest` с причиной, размером/хешем и текущими manifests.
Исследовательский слой отдельно получает согласованный обезличенный образец,
происхождение и версию источника. Runtime не отправляет байты автоматически.
`AdapterCandidate` содержит unverified specification, proposed ID/version
и hashes фикстур; у кандидата нет runtime методов.

~~~text
Unknown format
  → отдельное исследование / AI suggestion (unverified candidate)
  → проверка схемы, mappings и fixtures
  → одобрение и reviewed static implementation
  → versioned registry
~~~

Validation gate проверяет golden fixtures из независимых примеров,
unknown input, несовместимые версии, malformed/schema/reference failures,
детерминированный replay и лимиты bytes/records/result/CPU. Нужны ревью
безопасности, происхождения и допустимости данных, затем обычные CI и
cloud acceptance. Декларативные mappings предпочтительны там, где достаточны.
Бинарный формат может потребовать отдельно проверенного decoder.
LLM provider, стоимость, API-доступ и среда исполнения остаются отдельными
решениями. В MIG-03 реализованы только типы границы; AI API, исполнение
suggestions и автоматическое продвижение кандидата не подключены.

## 8. Логирование и операционная наблюдаемость — обязательный контракт

**Каждый значимый шаг должен иметь диагностическое событие.** Это относится к успешным веткам, ошибкам, таймаутам, ретраям, отказу от ретрая, `ack/retry` и cleanup. Архитектура не должна требовать дополнительного диагностического PR после очередного падения.

### 8.1. Корреляция

Обязательные поля событий (когда применимы):

| Поле | Назначение |
| --- | --- |
| `timestamp` | UTC с миллисекундами |
| `trace_id` | Сквозная операция |
| `job_id` | Техническое задание |
| `workflow_instance_id` | Выполнение Workflow |
| `run_id` | GitHub Actions run, когда есть |
| `component / stage / event` | Где и что произошло |
| `status` | STARTED / OK / FAILED / RETRY / SKIPPED / NOT_OBSERVED / NOT_REACHED |
| `attempt / duration_ms` | Попытка и длительность |
| `expected / actual / error_code` | Контракт и причина |
| `worker_version / processor_version` | Реальный исполняемый код |
| `details` | Только разрешённая структурированная диагностика |

Единый `trace_id` должен связывать Queue delivery, D1 job, Workflow, процессор, результат R2 и cleanup. Старые trace events уже нормализуются sanitizer'ом `migration/trace.mjs`; новые поля надо **явно добавить в allowlist**, а не пробрасывать непроверенный объект в console.

### 8.2. Матрица обязательной видимости

| Этап | События / доказательства |
| --- | --- |
| Queue | received, envelope field checks, upload/smoke/result/trace classification, rejected, dedup, ack/retry **с причиной** |
| D1 registration | lookup, exists/absent, insert/upsert, readback, delivery count |
| Workflow dispatch | create STARTED/OK/FAILED, lost-response reconciliation, retries, instance ID |
| Workflow runtime | invocation, validated operation, each step STARTED/OK/FAILED, duration, attempt, timeout, retry policy |
| Version | expected/observed Worker + processor, comparison, not-ready/ready |
| R2 input | HEAD, exact metadata/ETag checks, GET/Range, bytes read, truncation/limit, checksum |
| Processor | start, version, validation, detection, parsing, record checks, transformation, output validation, end/error |
| R2 output | result size/digest, conditional PUT, status, readback, checksum, conflict |
| D1 execution | create, CAS state transitions, final readback, reconciliation |
| Cleanup | start, enumerated synthetic resources, deletion, failure/attempt, final |
| Reports | first confirmed failure, last confirmed successful step, skipped/not-reached, unavailable source |

Предлагаемые машинные события для Processor: `PROCESSOR_STARTED`, `PROCESSOR_VERSION_CONFIRMED`, `INPUT_VALIDATION_STARTED/COMPLETED`, `FORMAT_DETECTION_STARTED/COMPLETED`, `FORMAT_UNSUPPORTED`, `INPUT_PARSING_STARTED/COMPLETED`, `RECORD_VALIDATION_STARTED/COMPLETED`, `TRANSFORMATION_STARTED/COMPLETED`, `RESULT_SCHEMA_VALIDATION_STARTED/COMPLETED`, `PROCESSOR_COMPLETED/FAILED`.

Для R2 result: `RESULT_BUILD_STARTED/COMPLETED`, `RESULT_SIZE_VERIFIED`, `RESULT_SHA256_CALCULATED`, `RESULT_R2_PUT_STARTED/COMPLETED`, `RESULT_R2_READBACK_STARTED/COMPLETED`, `RESULT_CHECKSUM_VERIFIED`, `RESULT_CONFLICT_DETECTED`.

Для D1: `D1_EXECUTION_CREATED/READ`, `D1_STATE_TRANSITION_STARTED/COMPLETED/REJECTED`, `D1_FINAL_READBACK_STARTED/COMPLETED`, `D1_EXECUTION_RECONCILED`.

При CPU limit аварийное завершение может лишить runtime возможности вывести финальный event: обогащать отчёт внешними сведениями о Workflow state и invocation telemetry, не выдумывая отсутствующую строку. `wall time` не выдавать за `CPU time`.

### 8.3. Система сбора

- Cloudflare Worker Observability: включены invocation logs и логирование, sampling = 1; доступ к API логов может быть ограничен.
- Private R2 fallback: префикс `_migration-traces/`, только санитизированные события. Записи трассы не должны сами создавать production jobs.
- Workflow history: независимый источник статусов steps/attempts.
- GitHub Actions: хронологический log, Step Summary, `migration-trace.json` в artifact, даже при падении.
- При недоступном источнике честно отображать `NOT_OBSERVED`/`Collection: PARTIAL`, а не объявлять полное покрытие.
- Не хранить в trace сырой файл, содержимое тренировок, фото, Telegram initData, подписанные URL, Authorization headers, токены, приватные SQL-параметры, stack с чувствительными значениями.
- Для больших потоков фиксировать фазу, размер, диапазон, checksum и итоги, **не каждый байт/пакет**.

### 8.4. Чего должно хватать при неудаче

Из **одного** GitHub Actions run должно быть понятно: какая версия реально исполнялась, какой файл и размер были подтверждены, на каком шаге впервые доказан отказ, где был последний достоверный успех, сколько попыток было, какие действия не запускались, что неизвестно из-за отсутствия телеметрии, прошёл ли cleanup.

Точный текст ошибки пользователя не должен становиться частью публичного trace; использовать стабильные коды и безопасные классификации.

## 9. Безопасность, доступ и персональные данные

- `mezfit-migration` остаётся приватным, без публичного fetch endpoint, произвольных скриптов и автоматического доступа в Dexie Cloud.
- Входные объекты создаются только через существующий ограниченный механизм SigV4; сам signer ещё не является пользовательским endpoint.
- Не читать/записывать R2 исходники по произвольному supplied key без проверки registration, префикса и object metadata.
- R2 event notifications, Queue payload и JSON исходного файла — недоверенные. Все поля проверять.
- Upload на 100 MiB и processor CPU/RAM budget — **независимые** ограничения.
- В D1 допустимы технические ID, состояния, ключи объектов и коды ошибок, **не** содержимое дневников.
- В будущей публикации определять Coach/Client ownership и realm на сервере; нельзя выводить права из Diary name, R2 key, присланного client ID или UI.
- В будущем importer должен поддерживать предпросмотр, явно выбранный объект импорта, отрицательные проверки чужих realm, idempotent import manifest и протокол частичного отказа.
- Отдельно определить сроки хранения исходника, технического результата, логов и политику удаления; **не считать их согласованными только по факту наличия R2**.
- При повторном импорте нужна явная стратегия конфликтов и дубликатов; не переписывать существующие FACT/PLAN автоматически.
- Токены/секреты — только разрешённая server/GitHub конфигурация. Не расширять права автоматически.

## 10. Этапность и дорожная карта

Обозначения: **Done** — подтверждено реальным результатом; **Next** — ближайшая реализация; **Planned** — архитектурное направление, требующее дополнительных решений/доказательств.

| Этап | Статус | Результат и критерий выхода | Блокеры / зависимости |
| --- | --- | --- | --- |
| **0. Исследование Gym Keeper** | Частично Done | Статический анализ APK, разделение backup vs Program/Diary export, список неизвестных полей | Нужны реальные образцы для decoder |
| **1. Cloudflare Migration Infrastructure** | **Done** | `MIGRATION_SMOKE_OK` на независимом run 44094545908 | Известные остатки: telemetry API 403, race версий |
| **2. TypeScript File Processing Engine v1** | **Done для synthetic** | Независимый processor smoke 44156101755 и infra smoke 44153088455 | Telemetry PARTIAL, CPU не измерен |
| **MIG-03. Универсальный Adapter Engine** | **Код реализован, cloud acceptance ожидается** | Registry/dispatcher + fixture/nested + общий runtime codec, отрицательные и anti-overfitting тесты | CI после PR, отдельная проверка новой версии после merge |
| **3. Доказать реальные форматы** | Planned, независимо от MIG-03 | Обезличенные samples, magic/schema, versioned compatibility matrix, фикстуры | Экспорт из реального Gym Keeper |
| **4. Адаптеры реальных источников, начиная с Gym Keeper** | Planned | Decoders по подтверждённым format/version и независимым samples | MIG-03 и этап 3 |
| **AI Discovery / Adapter Builder** | Planned | Исследование неизвестного формата, candidate → validation gate → reviewed registry | Решение по AI API/стоимости/приватности и образцы |
| **5. Канонизация и preview** | Planned | Модель Mezfit, стабильная ID mapping, PLAN/FACT, date/units, warnings/loss report, pre-import diff | Подтверждённая структура, доменные контракты |
| **6. Авторизованная публикация** | Planned, требует продуктового решения | Ограниченный import service, realm authorization, idempotent commit, rollback/recovery | Согласование способа записи в Dexie Cloud/ACL |
| **7. Пользовательский UX** | Planned | Выбор источника/цели, загрузка, прогресс, предпросмотр, подтверждение, статус/ошибки | Этапы 4–6, auth integration |
| **8. Эксплуатация и расширение покрытия** | Planned | Версионирование адаптеров, support tooling, retention, privacy/monitoring, сложные варианты backup | Реальные размеры/форматы и подтверждённые квоты |

### 10.1. Этап 2 — подробный вертикальный срез

Реализованные блоки, принятые на synthetic v1:

1. **Processor contract:** детерминированная TypeScript-библиотека, synthetic JSON v1, bounded reads, schema validation, result digest, safe errors.
2. **Execution persistence:** аддитивная D1 migration, уникальность job + processor version, terminal states, conditional transitions.
3. **Workflow integration:** `process` без нарушения `smoke/cleanup`, безопасный dispatch из Queue, потерянные ответы, duplicate events.
4. **Output persistence:** immutable result path, conditional write, readback/checksum, D1 reconciliation.
5. **Observability:** расширение существующего trace allowlist и collector до всех новых операций.
6. **Readiness:** фактическое подтверждение Worker version, а не пауза наугад.
7. **E2E smoke:** синтетический R2 object действительно проходит *весь* processor pipeline; negative tests показывают корректную диагностику.

**Definition of Done по этапу 2:** после merge и отдельной облачной проверки успешно получены оба сигнала:

~~~text
MIGRATION_SMOKE_OK
MIGRATION_PROCESSOR_SMOKE_OK
~~~

Оба маркера получены в независимых запусках, см. §2.4. Unit/mocked проверки MIG-03 ещё требуют CI; облачная приёмка v1 до MIG-03 не подтверждает новую реализацию автоматически.

### 10.2. MIG-03 и этап 3 — универсальность и реальные входные данные

Для MIG-03 следующий рубеж — CI, merge и отдельное разрешение на cloud rollout новой Worker version. Действующий processor smoke проверяет fixture-v1; запуск этого smoke после MIG-03 подтвердит его регрессию. Второй адаптер проверяется добавленным интеграционным тестом. Для его отдельной live-приёмки нужен согласованный bounded synthetic probe через тот же приватный process path. До такого запуска nested cloud status остаётся pending. Реальный дамп для реализации MIG-03 не нужен.

Подход по адаптерам:

~~~text
Source file
  → shared dispatcher / versioned registry
      ├─ synthetic fixture + nested (MIG-03)
      ├─ GymKeeperFullBackupAdapter (planned, после sample)
      └─ GymKeeperDiaryProgramAdapter (planned, после sample)
  → validate references and types
  → normalize units, dates, IDs, exercise relations
  → canonical import package + loss/warnings report
~~~

Для каждого parser фиксировать: supported-version manifest, fixtures/golden tests, unsupported cases, checksum sample, точную политику неизвестных полей, reference integrity. Если реальная full backup требует тяжёлого Realm/binary decoder, **не** обещать выполнимость на Workers Free без отдельного бенчмарка и решения по архитектуре.

### 10.3. Этапы 5–6 — переход от parse к бизнес-импорту

Нельзя «распечатать JSON в D1» и назвать это переносом в Mezfit. Нужны доменные decisions:

- сопоставление клиента/Diary с подтверждённым coach-client relationship;
- назначение Program и разрешённый владелец PLAN;
- даты и timezone workout occurrences;
- разграничение template PLAN, planned occurrence и historical FACT;
- snapshot исходного упражнения для отображения истории даже после архивации;
- сопоставление глобальных и пользовательских упражнений без доступа к чужому каталогу;
- вес/повторения/время/дистанция и единицы измерения;
- повторный импорт, versioned manifest, dry-run diff, сохранение provenance;
- rollback/recovery после неполной публикации и запрет частичной скрытой порчи чужих realm.

**Публикация в Dexie Cloud — отдельная явная привилегированная операция,** архитектура которой зависит от текущих подтверждённых Dexie Cloud API и схемы/ACL. Не утверждать способ публикации до отдельного согласования и live проверки прав.

## 11. Пороговые решения и блокеры

| Вопрос | Текущее решение | Когда возвращаться |
| --- | --- | --- |
| TypeScript или Python | **TypeScript**, единый существующий runtime | Только при измеренном блокере Free и согласии пользователя |
| Containers / VPS | **Не используем** | Только после нового решения о цене/эксплуатации |
| Лимит upload 100 MiB | **Сохраняем** | Processor может поддерживать меньший доказанный объём, явно |
| Полная обработка 100 MiB | **Не гарантирована** | После оценки CPU/RAM на реальных образцах |
| Backup `.dbi` | **Не декодируется до подтверждения** | После получения file sample |
| JSON Program/Diary | **Не считать доказанным до sample** | После определения реальной схемы |
| Куда писать бизнес-данные | Только Dexie Cloud через одобренный путь | Перед этапом 6 |
| D1 | Только технический job/execution state | Нельзя превращать в business store |
| Workers Logs API 403 | R2 trace fallback, partial status | При отдельном согласовании permissions |
| Deploy version race | Readiness gate реализован и прошёл v1 smoke | Проверять фактическую версию при каждом rollout |
| Retention персональных backup | **Не определён** | До пользовательского запуска и production import |
| Пользовательская авторизация upload | **Не подключена** | До UI/пользовательского доступа |
| Удаление старых данных | Только безопасная synthetic cleanup сейчас | Политика для пользовательских backups отдельно |

## 12. Приёмка, тесты и порядок выпуска

### 12.1. Каждый функциональный этап

Проверяются: happy path, невалидные данные, превышение размера, отсутствие объекта, нарушенные связи, duplicate Queue, lost replies, idempotency, неверная версия Worker, R2/D1 частичный отказ, cleanup, trace coverage и отсутствие секретов в логах.

**Существующие тесты не подгонять** под новую реализацию. Старые менять только в разрешённых `AGENTS.md` случаях; в других случаях сообщать пользователю и ждать решения.

После коммитов и **до PR** — ручное ревью diff, регрессий, актуальности тестового кода, AGENTS и `audit/`. Нельзя запускать локальные `npm`/`typecheck`/`tests` для обхода установленного workflow проекта: CI выполняет это после PR. Создание PR — не доказательство зелёного CI.

### 12.2. Облачный rollout

Этап 2 synthetic принят по §2.4. Следующая последовательность применяется отдельно к новой версии MIG-03; ручной запуск выполняет владелец или агент по явному разрешению.

1. PR: только проверенный, ограниченный scope.
2. CI после PR: review результатов, merge лишь после необходимых проверок.
3. Отдельный manual deploy на `main` владельцем репозитория.
4. Сначала проверить реально выполняемую версию, затем запускать processor smoke.
5. Провести независимый инфраструктурный smoke и processor smoke.
6. Сохранить ссылки на run, Git commit, Worker version, trace ID, подтверждённый результат.
7. При неудаче: разбирать stage/attempt/root evidence из одного trace, не добавлять «слепой» retry/timeout без причин.

Production Engine не должен выполняться на GitHub Actions: GitHub управляет деплоем, проверками и диагностикой, вычисления выполняет Cloudflare Worker/Workflow в допустимых пределах.

### 12.3. Готовность для пользователей

Функция импорта не готова к выпуску, пока нет подтверждённых форматов, прав доступа, preview/dry-run, защиты от повторного импорта, безопасной публикации в Dexie Cloud, retention/delete, понятной диагностики отказов и восстановимого пути после частичного commit.

## 13. Источники и точки входа для следующего чата

**Сначала прочитать:**

1. Корневой [`AGENTS.md`](AGENTS.md) — обязательные инженерные, security и PR-правила.
2. [`docs/architecture/local-first-storage-sync.md`](docs/architecture/local-first-storage-sync.md) — главный контракт бизнес-хранилища, Coach/Client realms и PLAN/FACT.
3. [`docs/architecture/migration-infrastructure.md`](docs/architecture/migration-infrastructure.md) — детальная уже реализованная инфраструктура, операции bootstrap/deploy/smoke/trace.
4. [`docs/reference/gym-keeper/backup-format.md`](docs/reference/gym-keeper/backup-format.md) — доказанное и неустановленное про backup/export.
5. [`docs/reference/gym-keeper/program-diary-domain.md`](docs/reference/gym-keeper/program-diary-domain.md), [`final-synthesis.md`](docs/reference/gym-keeper/final-synthesis.md) — перенос смыслов, не Android UI.
6. `migration/worker/processor/{contracts,registry,index}.ts`, `processor/adapters/`, `process-workflow.ts`, `execution-store.ts`, `processor-smoke.ts` — контракт адаптеров и единственный runtime path. Затем `index.ts`, `events.ts`, `smoke.ts`, `r2-upload.ts`, `trace.ts`, `migration/trace.mjs`, `trace-collector.mjs`, `cloudflare.mjs`.
7. `migration/d1/` — действующая техническая схема.
8. `.github/workflows/migration-*.yml` — manual deployment и диагностика.
9. `audit/2026-09-16_application_audit.md` — существующие риски и требования проверки перед PR.

**Подтверждённая эксплуатационная точка:** этап 2 synthetic, независимые infra/processor runs 44153088455 / 44156101755, точные версии и ссылки в §2.4. Код MIG-03 ожидает собственной облачной проверки.

**Примечание по аудиту:** в историческом аудите фактор `A-011` описывает дублирование числового префикса миграций в **другой части** приложения. Новые D1 migrations из `migration/d1/` должны иметь свои последовательно возрастающие уникальные имена, не переименовывать ранее применённые файлы. Этот документ не меняет схему и не устраняет старый фактор.

## 14. Краткая памятка следующему исполнителю

**Уже есть:** приватная связка R2 → Queue → Worker → D1 → Workflow, подтверждённый `MIGRATION_SMOKE_OK`, жёсткий SigV4 upload, безопасная private R2 trace; известны Workers Logs API 403 и race версий после deploy.

**Реализовано в MIG-03:** универсальный registry/dispatcher, проверенные fixture/nested adapters, совместимость legacy v1 и runtime codec schema v2, граница будущего AI discovery. CI и cloud acceptance новой реализации ожидаются. Этап 2 synthetic v1 уже принят, §2.4.

**Пока не знаем:** реальный byte format `.dbi` и JSON exports, CPU-стоимость настоящего decoder, точную модель импорта в Dexie Cloud и политику хранения пользовательских файлов.

**Нельзя:** объявлять synthetic parser настоящим Gym Keeper importer, переносить бизнес-данные в D1, менять Coach/Client realms или ACL без согласования, добавлять Python/Containers/VPS, считать «деплой завершён» равным «новая версия исполняется», давать успешный отчёт при неполной трассе без пометки PARTIAL.

**Следующий проверяемый рубеж:** CI MIG-03, merge, отдельный rollout новой версии и подтверждение fixture regression плюс согласованная проверка nested в Cloudflare. Параллельно можно исследовать реальные обезличенные экспорты. AI API, decoder, бизнес-канонизация, preview и Dexie commit остаются отдельными этапами.
