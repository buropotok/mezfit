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

The smoke check invokes the private Workflow through the authenticated
Cloudflare management API. It tries signed PUTs with the wrong MIME, length
or write-once header and an expired signature, then uploads synthetic bytes.
It verifies HEAD, overwrite rejection and anonymous read rejection, waits for
the R2 notification to create a D1 row, and replays that event through the Queue.
The Workflow removes the synthetic object on success and leaves its technical
job record for inspection. In a failed run, the instance ID identifies the
synthetic `smoke/<instance-id>` object for diagnosis.
