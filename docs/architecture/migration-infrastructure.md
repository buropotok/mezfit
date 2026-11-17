# Cloudflare migration infrastructure

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

Run both workflows as the repository owner on `main` after merging:

1. Run **Bootstrap migration infrastructure** in `preview` mode to read the
   resource state and planned changes.
2. Run it in `apply` mode with `APPLY_MEZFIT_MIGRATION_INFRASTRUCTURE`. It creates
   any missing resources and publishes the uploader credentials directly as
   Worker Secrets via an initial private deployment. The initial deployment has
   no Queue consumer until the D1 schema has been installed.
3. Run **Deploy migration Worker**. It applies the D1 migrations, deploys the
   Worker, Queue binding and Cloudflare Workflow, and runs the live smoke check.

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
header and expiry. Each checks the S3 error semantics and absence of a probe
object. The write-once and anonymous read checks exercise the uploaded object.
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
