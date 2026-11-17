# Migration — архитектура, техническая концепция и дорожная карта

**Проект:** Mezfit · **Репозиторий:** `buropotok/mezfit`  
**Дата фиксации контекста:** 17 ноября 2026 г.  
**Статус:** архитектурный документ / ориентир для следующих этапов, **не** свидетельство реализации запланированного кода.  
**Текущая точка:** Cloudflare Migration Infrastructure прошла независимый smoke. TypeScript File Processing Engine v1 реализован для синтетического JSON и ожидает развёртывания и проверки в Cloudflare. [Инструкция запуска](docs/architecture/migration-infrastructure.md#проверка-typescript-execution-engine).

> **Назначение.** Это основной документ для нового рабочего чата, архитектора и разработчика, продолжающего миграцию из Gym Keeper в Mezfit. Здесь зафиксированы задача, принятые решения, границы системы, подтверждённые результаты, ещё не реализованные контракты, риски, этапы, порядок приёмки и источники. Тексты поручений агентам сюда намеренно не включены.

## 1. Цель и ожидаемый продукт

Mezfit — система «тренер — клиент», в которой тренер составляет программу (PLAN), назначает тренировки, а выполнение и история (FACT) имеют отдельную модель. Gym Keeper — локальный Android-дневник тренировок. Его модель нельзя механически переносить в Mezfit: исходная программа, запланированная тренировка и выполненная тренировка — разные сущности с разной семантикой доступа и жизненного цикла.

**Продуктовая цель миграции:** дать тренеру контролируемый путь переноса пригодных данных Gym Keeper — программ, дневников и исторических результатов — в структуру Mezfit с предварительной проверкой, точным отображением пропусков и ошибок, без потери исходного файла и без нарушения границ Coach/Client.

Целевой путь (с разделением технической подготовки и бизнес-публикации):

~~~text
Файл Gym Keeper / экспорт пользователя
           │
           ▼
Приватная загрузка в Cloudflare R2
           │
           ▼
Проверка, регистрация, безопасная обработка
           │
           ▼
Версионированный структурированный результат
           │
           ▼
Gym Keeper Import Adapter (после исследования формата)
           │
           ▼
Каноническая промежуточная модель импорта Mezfit
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
| TypeScript File Processor | **Синтетический формат v1, cloud smoke ожидается** |
| Операция Workflow `process` | **Подключена к Queue, cloud smoke ожидается** |
| Таблица технических `migration_executions` | **Аддитивная миграция 0003, ожидает применения в Cloudflare** |
| R2 JSON result write/readback для processor | **Реализованы с SHA-256, cloud smoke ожидается** |
| `MIGRATION_PROCESSOR_SMOKE_OK` | **Пока не получен** |
| Чтение реального Gym Keeper `.dbi` | **Формат не подтверждён** |
| Импорт Program / Diary JSON | **Схема образца не подтверждена** |
| Нормализация в модель Mezfit | **Будущий этап** |
| Безопасная публикация в Dexie Cloud | **Будущее отдельное архитектурное решение** |
| Пользовательский экран импорта | **Будущий этап** |

Новые рабочие чаты должны сверять эту таблицу с текущим `main` и последними успешными cloud-run. Наличие описания в этом файле само по себе не означает готовой реализации.

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
| `migration/worker/index.ts` | Queue entrypoint, операции Workflow `smoke` и `cleanup` | Типизированная операция `process`, без разрушения остальных |
| `migration/worker/events.ts` | Проверка события и регистрация `migration_jobs`; `ack/retry` | Подтверждённый идемпотентный запуск процесса |
| `migration/worker/r2-upload.ts` | SigV4 и формат upload keys | Без изменения контракта подписанной загрузки |
| `migration/worker/smoke.ts` | Инфраструктурный end-to-end smoke | Сохранить без регрессий |
| `migration/trace.mjs` | Общий schema/sanitizer событий | Добавить безопасные поля нового processor |
| `migration/worker/trace.ts` | Сбор/резервирование trace | Поддержать техоперации processor |
| `migration/trace-collector.mjs` | Корреляция логов из нескольких источников | Покрытие `process`, D1, R2 result |
| `migration/cloudflare.mjs` | Cloudflare API, bootstrap/deploy/diagnose, trace | Проверка готовности версии и новый smoke |
| `migration/wrangler.json` | Только приватный Worker, bindings и observability | Не создавать Container |
| `migration/d1/0001_create_migration_jobs.sql` | Техническая регистрация upload, states `uploaded/rejected` | Не менять старую семантику |
| `migration/d1/0002_create_migration_smoke_replays.sql` | Exact replay receipt | Не смешивать с бизнес-импортом |
| `.github/workflows/migration-deploy.yml` | Deploy и действующий smoke | Readiness gate + processor smoke по готовности |
| `.github/workflows/migration-smoke.yml` | `diagnose` / `smoke` | Независимая проверка process без обязательного redeploy |

Инфраструктурные endpoints Worker сейчас приватные: `workers_dev=false`, `preview_urls=false`, публичный обработчик `fetch` для них не настроен. Подписанный upload helper предназначен для будущей авторизованной интеграции, а не является уже опубликованным API для пользователя.

### 5.1. Состояния регистрации файла

Сейчас `migration_jobs` имеет только `uploaded` и `rejected`. Изменение исходного статуса при повторной Queue-доставке не должно превращаться в отдельную регистрацию, а действующая политика увеличения `deliveries` не должна приводить к запуску нескольких бизнес-исполнений.

Новая таблица обработки должна быть **отдельной**: регистрация объекта и результат его разбора — разные жизненные циклы.

### 5.2. R2 namespace и фильтрация событий

Планируемые префиксы и правила:

| Prefix | Назначение | Автоматический production process |
| --- | --- | --- |
| `uploads/<uuid>` | Входные файлы | Да, после проверки регистрации |
| `smoke/<uuid>` | Синтетический инфраструктурный smoke | Нет |
| `results/<job-id>/<processor-version>/result.json` | Технический JSON-результат | Нет |
| `_migration-traces/...` | Санитизированная диагностика | Нет |

В текущем Consumer уже есть специальная фильтрация trace и expiry-control smoke. Для `results/` потребуется отдельная явная проверка; нельзя допускать рекурсивное создание заданий от записи результата в тот же bucket.

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

Ориентир: `migration/worker/processor/` с модулями определения формата, чтения, валидации, трансформации и схемы результата. Это **план расположения**, не уже существующий каталог.

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

Предлагаемая новая аддитивная D1 migration: `migration_executions`.

Поля/инварианты (точный SQL согласовать с текущим D1-контрактом):

| Поле | Значение |
| --- | --- |
| `job_id`, `object_key` | Ссылка на зарегистрированный исходный upload |
| `input_etag`, `input_size` | Контрольный снимок исходного объекта |
| `processor_version` | Версия алгоритма; часть уникального ключа идемпотентности |
| `workflow_instance_id` | Детерминированная корреляция |
| `status` | `queued / running / succeeded / failed / unsupported` |
| `attempt_count` | Учёт bounded retries |
| `result_key`, `result_sha256` | Подтверждённый результат |
| `error_code` | Безопасная машинная причина |
| `created_at / started_at / finished_at / updated_at` | Диагностика |

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

Минимальная целевая схема `result.json` (версионированная, runtime-validated):

~~~json
{
  "schema_version": 1,
  "job_id": "<uuid>",
  "processor_version": "1.0.0",
  "status": "succeeded",
  "input": {
    "size_bytes": 123,
    "sha256": "<sha256>",
    "detected_format": "synthetic-json-fixture"
  },
  "summary": {
    "records_validated": 1,
    "warnings_count": 0
  },
  "warnings": []
}
~~~

Схема примерная: производственный контракт фиксируется реализацией. Не выдавать `synthetic-json-fixture` за Gym Keeper export. `unsupported` (формат) и `failed` (технический отказ/целостность) различаются. Ошибки не должны содержать исходных чувствительных записей.

Ограничить результат, исходное предложение — не более **2 MiB**. После PUT выполнить HEAD/readback и сверку размера/хеша **до** финального D1 `succeeded`. Исходный объект не удалять и не переписывать.

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
| **2. TypeScript File Processing Engine** | **Next** | Реальный `R2 → Queue → Workflow → TS → R2 result → D1`; `MIGRATION_PROCESSOR_SMOKE_OK`; регрессия infra smoke | Workers Free limits, version gate, надежное логирование |
| **3. Доказать реальные форматы** | Planned, можно параллельно 2 | Обезличенные samples, magic/schema, versioned compatibility matrix, фикстуры | Экспорт из реального Gym Keeper |
| **4. Gym Keeper Import Adapters** | Planned | Отдельные decoders по подтверждённым format/version, чёткие ошибки, normalized output | Этапы 2–3 |
| **5. Канонизация и preview** | Planned | Модель Mezfit, стабильная ID mapping, PLAN/FACT, date/units, warnings/loss report, pre-import diff | Подтверждённая структура, доменные контракты |
| **6. Авторизованная публикация** | Planned, требует продуктового решения | Ограниченный import service, realm authorization, idempotent commit, rollback/recovery | Согласование способа записи в Dexie Cloud/ACL |
| **7. Пользовательский UX** | Planned | Выбор источника/цели, загрузка, прогресс, предпросмотр, подтверждение, статус/ошибки | Этапы 4–6, auth integration |
| **8. Эксплуатация и расширение покрытия** | Planned | Версионирование адаптеров, support tooling, retention, privacy/monitoring, сложные варианты backup | Реальные размеры/форматы и подтверждённые квоты |

### 10.1. Этап 2 — подробный вертикальный срез

Планируемые блоки:

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

Ни один unit test или mock сам по себе не заменяет live smoke. До получения второго маркера выполнение processor — только планируемая функциональность.

### 10.2. Этап 3 — форматные входные данные

Подход по адаптерам:

~~~text
Source file
  → detect format + supported versions
      ├─ GymKeeperFullBackupAdapter (только после sample)
      └─ GymKeeperDiaryProgramAdapter (только после sample)
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
| Deploy version race | Подтверждённый риск, нужен gate | В составе этапа 2, до live smoke |
| Retention персональных backup | **Не определён** | До пользовательского запуска и production import |
| Пользовательская авторизация upload | **Не подключена** | До UI/пользовательского доступа |
| Удаление старых данных | Только безопасная synthetic cleanup сейчас | Политика для пользовательских backups отдельно |

## 12. Приёмка, тесты и порядок выпуска

### 12.1. Каждый функциональный этап

Проверяются: happy path, невалидные данные, превышение размера, отсутствие объекта, нарушенные связи, duplicate Queue, lost replies, idempotency, неверная версия Worker, R2/D1 частичный отказ, cleanup, trace coverage и отсутствие секретов в логах.

**Существующие тесты не подгонять** под новую реализацию. Старые менять только в разрешённых `AGENTS.md` случаях; в других случаях сообщать пользователю и ждать решения.

После коммитов и **до PR** — ручное ревью diff, регрессий, актуальности тестового кода, AGENTS и `audit/`. Нельзя запускать локальные `npm`/`typecheck`/`tests` для обхода установленного workflow проекта: CI выполняет это после PR. Создание PR — не доказательство зелёного CI.

### 12.2. Облачный rollout

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
6. `migration/worker/index.ts`, `events.ts`, `smoke.ts`, `r2-upload.ts`, `trace.ts`, `migration/trace.mjs`, `trace-collector.mjs`, `cloudflare.mjs` — фактические владельцы текущих операций.
7. `migration/d1/` — действующая техническая схема.
8. `.github/workflows/migration-*.yml` — manual deployment и диагностика.
9. `audit/2026-09-16_application_audit.md` — существующие риски и требования проверки перед PR.

**Подтверждённая эксплуатационная точка:**  
https://github.com/buropotok/mezfit/actions/runs/44094545908  
**`MIGRATION_SMOKE_OK`, 17 ноября 2026 г.**

**Примечание по аудиту:** в историческом аудите фактор `A-011` описывает дублирование числового префикса миграций в **другой части** приложения. Новые D1 migrations из `migration/d1/` должны иметь свои последовательно возрастающие уникальные имена, не переименовывать ранее применённые файлы. Этот документ не меняет схему и не устраняет старый фактор.

## 14. Краткая памятка следующему исполнителю

**Уже есть:** приватная связка R2 → Queue → Worker → D1 → Workflow, подтверждённый `MIGRATION_SMOKE_OK`, жёсткий SigV4 upload, безопасная private R2 trace; известны Workers Logs API 403 и race версий после deploy.

**Сейчас строим:** TypeScript File Processing Engine без платного Container на Workers Free, отдельный технический execution state, R2 JSON result, full trace, version gate и независимый `MIGRATION_PROCESSOR_SMOKE_OK`.

**Пока не знаем:** реальный byte format `.dbi` и JSON exports, CPU-стоимость настоящего decoder, точную модель импорта в Dexie Cloud и политику хранения пользовательских файлов.

**Нельзя:** объявлять synthetic parser настоящим Gym Keeper importer, переносить бизнес-данные в D1, менять Coach/Client realms или ACL без согласования, добавлять Python/Containers/VPS, считать «деплой завершён» равным «новая версия исполняется», давать успешный отчёт при неполной трассе без пометки PARTIAL.

**Следующий проверяемый рубеж:** два независимых зелёных live smoke и документально подтверждённые версии Worker/processor. После него — получение реальных обезличенных экспортов и написание Gym Keeper Import Adapters.
