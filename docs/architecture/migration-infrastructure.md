# Cloudflare migration infrastructure

> Общая концепция миграции Gym Keeper → Mezfit, технические решения, текущий статус,
> этапы и дорожная карта описаны в [корневом `migration.md`](../../migration.md).
> Этот файл остаётся подробным описанием уже развёрнутой Cloudflare инфраструктуры.

The Mezfit Cloudflare account hosts two independently deployed Workers. The app
Worker `mezfit` owns the existing Telegram API and media integration.
`mezfit-migration` owns backup intake and its technical processing state.

| Resource | Name | Purpose |
| --- | --- | --- |
| Worker | `mezfit-migration` | Queue consumer and Workflow entrypoint |
| R2 bucket | `mezfit-migration-uploads` | Private backup objects |
| Queue | `mezfit-migration-events` | Object-create notifications and smoke replay |
| D1 database | `mezfit-migration-jobs` | Job ID, object metadata, state, timestamps, delivery count and error code |
| Workflow | `mezfit-migration-workflow` | Initial orchestration entrypoint and infrastructure smoke |

R2 sends object creation notifications to the Queue. The Worker validates the
event's account, bucket and generated object key, reads object metadata through
R2 HEAD, and registers one technical job per object key in D1. A duplicate
delivery can increase the delivery count. It cannot create a new row or change
the job's state. A missing object or inconsistent metadata is recorded as a
rejection. Transient R2 or D1 errors trigger Queue retries. Backup bytes and
user identity stay out of D1. Dexie Cloud remains the authoritative app database.

The upload module issues write-once SigV4 PUT capabilities with a 10-minute
lifetime, generated keys, and exact signed content length and MIME. The initial
limit is 100 MiB. The client will set Content-Type and If-None-Match and let its
HTTP runtime send Content-Length. CORS accepts PUT from `MEZFIT_APP_ORIGIN`.
The signer and HEAD verification are available for future authenticated
internal integration. Both workers.dev and Preview URLs are disabled, and the
Worker starts with Queue and Workflow entrypoints only.

## GitHub Actions rollout

**Initial bootstrap remains manual and owner-restricted** (on `main`):

1. Run **Bootstrap migration infrastructure** in `preview` mode to read the
   resource state and planned changes.
2. Run it in `apply` mode with `APPLY_MEZFIT_MIGRATION_INFRASTRUCTURE`. It creates
   any missing resources and publishes the uploader credentials directly as
   Worker Secrets via an initial private deployment. The initial deployment has
   no Queue consumer until the D1 schema has been installed.

**For subsequent migration-code merges**, `.github/workflows/migration-auto.yml`
triggers on `push` to `main` for the migration Worker, technical D1 migrations,
runner/scripts and relevant migration workflows. It runs, in order:

1. **Deploy migration**: apply only the migration-job D1 migrations, deploy the
   private migration Worker/Queue/Workflow and run the built-in infrastructure smoke.
2. **Processor smoke**: verify the synthetic fixture, output, replay and cleanup.
3. **Nested smoke**: verify synthetic nested adapter, references and cleanup.

All three share the `mezfit-migration-cloudflare` concurrency lock, run only on
`main`, and stop on the first failure. Each uploads a separate sanitized trace.
No PR, docs-only change, application Worker, Dexie Cloud role/schema operator,
bootstrap apply or user business import is triggered by this chain. **Merging a
migration-runtime PR now approves an automatic live migration Worker deploy and
potential technical D1 migrations.** The existing manual Deploy and Diagnose/smoke
workflows remain available for recovery and independent verification.

The workflows share a concurrency group. They use the existing account and
origin repository variables and the existing deployment and bootstrap secrets.
The bootstrap token manages migration resources and the account token policy.
The deployment token controls the Worker and Workflows and applies D1 migrations.
API errors identify the token, operation and Cloudflare error code. The only
R2 upload token created is `mezfit-migration-uploads-uploader`, with object
access scoped to the migration bucket. Its one-time S3 secret is written to a
temporary runner file for the Worker upload and removed afterward.

Bootstrap stops on conflicting CORS, event rules, public R2 settings, or
unexpected Queue, Worker, Workflow or token configuration. If the migration
uploader already exists and one or both Worker Secrets are missing, its
one-time credentials cannot be recovered. Check the failed bootstrap and
the Worker secret names. If the credentials cannot be recovered, explicitly
revoke only that uploader before rerunning bootstrap. In the partial-secrets
case, reconcile the existing private Worker and its secrets before retrying.

## Smoke and diagnosis

Run **Diagnose or smoke-test migration infrastructure** from `main` as the
repository owner. Select `diagnose` with the Workflow instance UUID to read
its status and step attempts via Cloudflare's management API. To examine the
failed deployment from 2026-11-17, use
`a9292ed7-b383-45ad-aa27-665cd70f91a2`. The diagnostic job uses the existing
deployment token for GET requests. If Cloudflare no longer retains the
instance, use the report from a fresh smoke run.

Select `smoke` to check the deployed resource configuration and run the same
integration verification as deploy. The runner submits an object in
`params`, matching the pinned Wrangler command, and looks up the same UUID
when the create reply is lost. It reports saved step and attempt history,
a stable code, and safe expected and actual values. Unclassified Cloudflare
errors include an exception category and a message fingerprint. The report
excludes payloads, raw exception messages and signatures.

The Workflow uploads one fixed-size synthetic object and checks HEAD, including
the ETag of the known body. After the actual R2 event registers the job in D1,
the Workflow publishes a marked replay through the same Queue. The consumer
records a receipt for the exact replay in the same D1 transaction as the job
write. Other duplicate deliveries cannot satisfy that check. The smoke verifies
the job's state and identity after the replay. The second D1 migration is
additive and must be applied by `migration-deploy.yml` before using the new
standalone smoke.

Separate probes use unique child keys for bad MIME, length, missing conditional
header and expiry. To establish expiry when the S3 error is opaque, smoke uses a
20-second capability for the isolated expiry key. It verifies a successful PUT
before expiry, removes the probe object, and waits durably. It then re-derives
the exact capability and verifies denial and absence of an object after expiry.
A fresh PUT for that same key confirms permissions still work. Explicit
signature, credential, clock and unrelated authorization failures remain
failures. The short TTL is reserved for the expiry probe. The overwrite check
requires 412 with S3 PreconditionFailed and an unchanged R2 object version.
The anonymous read check sends no authorization or query parameters.
Retries are bounded. A signed PUT that committed before the reply was lost is
reconciled using HEAD. Unambiguous contract and authorization errors fail
immediately.

Cleanup deletes only the synthetic keys under `smoke/<instance UUID>`.
A successful run deletes its objects before reporting success. After a terminal
failure, the Actions runner queues a cleanup instance and logs its ID. A later
smoke also performs a bounded sweep of recognized synthetic keys older than 24
hours to cover cancellations and runner interruption. Technical job and replay
receipt rows remain available for diagnosis. A running or paused instance's
objects are not deleted by the Actions runner.

## Trace coverage

All three Actions workflows upload `migration-trace.json`, including failed
runner executions. Use the Step Summary for the first confirmed failure and the
artifact for ordered timestamps, intermediate observations and every available
attempt. A Workflow instance UUID identifies a smoke across Worker invocations,
Queue delivery, D1 checks and cleanup. The GitHub run ID is joined by this UUID.

| Stage | Evidence captured | What can remain unobserved |
| --- | --- | --- |
| Bootstrap and deploy | Inputs by presence, method and endpoint template, status and duration for API attempts, resource comparisons, Wrangler migration/version and trigger milestones, deployed logging settings | Startup failures before the Node action begins appear in the native Actions log |
| R2 signing and upload | Signer validation, canonical request construction, signed header set, TTL, HTTP status and S3 code, exact HEAD observations, negative probes | Cloudflare may classify a transport error without exposing its network cause |
| R2 Event Notifications | Rule identity by expected bucket and queue, subscribed actions, prefix/suffix flags, confirmed PUT, Queue backlog snapshots | Cloudflare's aggregate backlog and rule configuration cannot establish per-object publication |
| Queue and consumer | Received message and attempt, safe identity/timestamp, envelope field eligibility, HEAD check, insert and promote, replay, ack/retry decision | An invalid event with no recoverable smoke UUID is visible in Worker logs but cannot be asserted to belong to a run |
| D1 | Operation and table, statement outcomes and changes, SELECT presence, exact replay receipt, confirmed state | D1 metadata alone cannot distinguish the INSERT from the ON CONFLICT branch; the trace reports that gap |
| Workflow and cleanup | Runtime operations and persisted attempt timestamps, polling, terminal state, cleanup dispatch and readback | Timed-out or interrupted invocations may leave runtime telemetry incomplete; the Workflow history remains a separate source |

The runner queries Workers Observability with existing credentials and records
permission, lag or partial results. It also reads a per-smoke recovery copy
under the private migration bucket prefix `_migration-traces/`. These objects
contain only sanitized diagnostic events. Their R2 notifications are explicitly
acknowledged without HEAD, writes to D1, or another trace object. Future smoke
runs remove expired trace objects through a bounded prefix sweep. If R2 and
Workers Logs both fail, the collector reports incomplete coverage and retains
the Workflow history, runner logs and available Queue/D1 observations.

A first merge-time smoke is required to verify Cloudflare's deployed settings
and the existing tokens' read access. The telemetry endpoint is documented
with **Workers Observability Write**; a refusal is shown in Actions. No token
change is needed when the existing R2 recovery channel is readable.

Workers Logs settings and Telemetry API authorization are checked separately.
One deployed run verified enabled logs, invocation logs and full sampling in
Worker settings while the Telemetry query returned HTTP 403. The private R2
trace recovered the smoke evidence in that run.

### Проверка TypeScript Execution Engine

На новых изменениях миграционного runtime после merge автоматически выполняется
`migration-auto.yml`: Deploy migration (включая `MIGRATION_SMOKE_OK`), затем
`processor-smoke` и `nested-smoke`. Ручные `Deploy migration Worker` и
`Diagnose or smoke-test migration infrastructure` остаются для самостоятельного
повторного запуска/диагностики. Начальный Deploy применял аддитивную миграцию
`0003_create_migration_executions.sql` перед выкладкой Worker.
Операция `processor-smoke` сверяет текущую версию деплоя с версией из Workflow runtime,
загружает синтетический JSON, проверяет результат и повторную доставку, удаляет
вход, результат и технические строки, затем выводит `MIGRATION_PROCESSOR_SMOKE_OK`.
Cleanup подтверждает отсутствие объектов в R2 и строк в трёх технических
таблицах D1. Если вход уже отсутствует, а результат или строки остались,
Workflow возвращает `PROCESSOR_CLEANUP_INCOMPLETE` и сохраняет найденные
артефакты для диагностики. При ошибке smoke и cleanup исходная ошибка smoke
остаётся ошибкой запуска, а отказ cleanup виден отдельно в трассе.
При сбое приложите из Actions `migration-trace.json`. CPU указывается только по
данным invocation telemetry. При отсутствии доступа диагностика продолжится по
приватным R2-трассам и Workflow history.

В `v1` поддерживается `mezfit-migration-fixture-v1` с лимитом 8192 байт и
256 записей. Smoke использует одновременно оба предела. Этот предел является
консервативной настройкой v1, проверенной synthetic smoke 44156101755.
MIG-03 сохраняет этот smoke и добавляет nested adapter с result schema v2.
MIG-03 deploy/infra/fixture smoke подтверждены runs 44181829987 / 44182935497 /
44183912443. Действующий processor-smoke использует fixture-v1. Контракты registry и отдельная приёмка nested описаны в migration.md §7.6 и §10.2.
Лимит загрузки технических объектов по-прежнему 100 MiB. Файлы свыше предела
процессора получают `PROCESSOR_INPUT_LIMIT` до чтения тела из R2. R2-результат
проверяется независимо от ответа PUT. Повторная запись состояния D1 использует
тот же подтверждённый результат.

### Облачная проверка второго адаптера

После merge миграционного runtime автоматическая цепочка вызывает Deploy,
`processor-smoke` и `nested-smoke` последовательно. При необходимости
владелец может отдельно повторить: Actions → **Diagnose or smoke-test migration
infrastructure** → **Run workflow** → branch `main` → operation `nested-smoke`.

Сценарий использует readiness gate и обычную R2 notification/Queue/D1/Workflow
обработку. Вход содержит несколько групп, неотсортированные items,
cross-group/forward references и пустую группу. Проверяется schema v2,
`synthetic-nested 1.0.0`, точный normalized output, EMPTY_GROUP, input/result
SHA-256, attempts=1, replay/idempotency и cleanup с R2/D1 readback.
Успех — `MIGRATION_NESTED_SMOKE_OK`, который появляется после очистки.

В Step Summary и артефакте `migration-trace.json` проверить source SHA,
Worker version, trace/job IDs, `ADAPTER_SELECTED` и
`PROCESSOR_SMOKE_ADAPTER_VERIFIED` для synthetic-nested 1.0.0,
стадии checksum/result/replay/cleanup. Исходные группы и значения в trace
не выводятся. При `Collection: PARTIAL` сохранить список недоступных
источников; Workers Logs 403, отсутствие CPU и per-object publisher receipt
сами по себе не дают полной наблюдаемости. При ошибке использовать diagnose
с UUID из отчёта. При timeout/active Workflow cleanup откладывается.

Live nested-smoke успешно пройден в [run 44201744839](https://github.com/buropotok/mezfit/actions/runs/44201744839):
`MIGRATION_NESTED_SMOKE_OK`, Worker version
`93a4ac02-7cce-4fec-b52c-13044e11c775`, trace ID
`1fe7b878-d142-4970-8ce2-2bc77be96784`. Детали в `migration.md` §2.5.
Для следующих изменений проверять актуальные SHA/Worker version и сохранять
их в Actions run/trace; этот run не подтверждает будущие версии.
