# Cloudflare infrastructure bootstrap (no GitHub Environments)

Status: proposed; no live Cloudflare resources, tokens, secrets or domains are
changed by preparing this pull request. Run the owner-only
`.github/workflows/bootstrap-cloudflare.yml` workflow manually **from main**
after review/merge. It uses GitHub **repository** secrets and variables only.
No new GitHub Environment is created or required.

## Goal and existing boundaries

Recreate the Cloudflare side of Mezfit in a new account from reviewed source:
D1 `mezfit`, R2 `mezfit` (existing exercise/GIF binding), isolated discussion
R2 `mezfit-discussion-media`, its browser CORS policy, scoped R2 S3 upload
credentials, D1 migrations and the existing Worker deployment (assets,
scheduled cron, Durable Object binding/migration, Images binding).

The discussion R2 bucket and token are **preparation only**. COMM-09 currently
allows Yandex only. This bootstrap does not modify the Yandex signer, switch
media transport, publish media, or change any Dexie Cloud ACL/schema.
Any discussion media R2 transport requires a separate reviewed exception to
COMM-09 and a matching Worker binding/route implementation. The existing Worker
`wrangler.jsonc` continues to bind `R2_BINDING_MEZFIT` to bucket `mezfit`.
The extra media bucket is intentionally not bound or exposed until that PR.
The token has **object** rights only in `mezfit-discussion-media`, not the
existing `mezfit` bucket.

## One-time setup for a new Cloudflare account

1. Activate Cloudflare Workers, D1 and **R2** for that account, and verify any
   billing/Images requirements. The bootstrap does not purchase or authorize a
   subscription and cannot create a Cloudflare account.
2. Set GitHub **repository variables**:
   - `CLOUDFLARE_ACCOUNT_ID`: exactly the new Cloudflare account's 32-hex ID.
   - `MEZFIT_APP_ORIGIN`: the deployed Mini App's exact HTTPS origin,
     e.g. `https://app.example.com` (not a path or wildcard).
   - Preserve existing `VITE_CLOUD_*` and `VITE_YANDEX_MEDIA_FUNCTION_URL`
     variables from the current deployment. The Worker URL/domain and Telegram
     Mini App URL are configured separately unless already managed by Cloudflare.
3. Set GitHub **repository secrets**:
   - `CLOUDFLARE_API_TOKEN`: deploy-capable token for Workers scripts/bindings,
     D1 migration operations and other resources actually used by deployment.
   - `CLOUDFLARE_BOOTSTRAP_API_TOKEN` (recommended separately): account-scoped
     provisioning token with **D1 Edit**, **Workers R2 Storage Write** (for
     bucket/CORS management), and **Account API Tokens Read + Write** (to
     create scoped R2 S3 credentials). It is never passed to npm/build or
     application deployment steps. Without this second secret the bootstrap
     falls back to `CLOUDFLARE_API_TOKEN`, which must have both sets of rights.
   - `TELEGRAM_BOT_TOKEN`: required to deploy a useful new Worker. The
     bootstrap must receive the existing bot token; it cannot mint one.
   - As required by enabled Mezfit functionality:
     `DEXIE_CLOUD_CLIENT_ID`, `DEXIE_CLOUD_CLIENT_SECRET`,
     `DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID`,
     `DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET`,
     `DEXIE_CLOUD_REMINDER_CLIENT_ID`,
     `DEXIE_CLOUD_REMINDER_CLIENT_SECRET`,
     `DEXIE_DISCUSSION_WEBHOOK_SECRET` and the test-only
     `R2_MEDIA_TELEGRAM_ALLOWLIST` if using a later R2 upload feature.
     Missing optional values are not uploaded and do not delete existing
     Worker secrets. Any functionality depending on them remains unavailable
     until restored. Set these repository secrets through trusted GitHub
     settings/secrets tooling; never commit or paste their values into logs.
4. **No GitHub Environments**, approval environments, new deploy secrets in
   code, personal access tokens for GitHub or privileges for workflow jobs
   beyond `contents: read` are required.

To generate an account-owned R2 S3 credential programmatically, Cloudflare
requires the initial privileged token to have `Account API Tokens Write`.
R2 returns the one-time token `value`; the S3 **Access Key ID** is the token
`id` and **Secret Access Key** is SHA-256 of `value`. The bootstrap
generates these only if the stable named token is missing. It stages the
result in a runner-local 0600 JSON file and uploads it through
`wrangler deploy --secrets-file`, along with supplied external Worker
secrets; the file is deleted by the workflow's unconditional cleanup step.
No R2 keys are committed, printed, uploaded as artifacts, sent to the
browser or saved to D1. The token is scoped to **object read/write** in
the discussion media bucket, never global R2 admin permissions.

## Running it

GitHub → Actions → **Bootstrap Cloudflare infrastructure** → Run workflow
on **main**, by the repository owner.

1. `operation=preview` (default): read-only. It reports which D1, R2, CORS
   and scoped token resources exist and which actions would occur.
2. `operation=apply`: enter exactly
   `BOOTSTRAP_CLOUDFLARE_INFRASTRUCTURE`. It creates missing resources,
   reconciles missing discussion CORS, optionally generates a new limited R2
   token, verifies resource readback, builds the app, applies existing D1
   migrations and deploys Worker with nonempty repository secrets.
3. A different **existing** discussion R2 CORS policy is never silently
   overwritten. To replace it, inspect preview and deliberately select
   `replace_existing_cors=true`. This affects only
   `mezfit-discussion-media`; the original `mezfit` bucket CORS is untouched.
4. `generate_r2_token=true` is the default. Set it to false when the
   provisioning token lacks account-token permissions or the R2 media upload
   integration is intentionally deferred. On later activation, issue another
   explicit bootstrap with generation enabled.

The workflow is owner/main/manual only, and shares the production
`mezfit-production-deploy` concurrency group. Ordinary push deployments
continue using the existing `deploy.yml`, not the privileged bootstrap.
The preview never performs POST, PUT, migrations, build, deployment or secret
changes.

## Idempotency and limitations

- D1 and R2 resources are discovered **by their exact names** and reused,
  including all stored data. D1 database IDs are resolved dynamically; IDs
  are never committed. Repeated runs never drop a database, bucket, or table.
- Existing token names are reused rather than silently regenerated; R2 API
  secret keys **cannot be read again** after creation. If a run is interrupted
  after token creation but before Worker secret publication, the original token
  becomes unrecoverable. Manually revoke that orphan token in Cloudflare and
  rerun; never silently rotate or delete credentials.
- Cloudflare R2 must already be activated for the account. Provisioning
  permissions and Workers/Images service availability must be granted.
- New D1 is **empty** except for migrated schema/seed. Existing D1 rows, R2
  objects, Cloudflare zone/domain DNS, Yandex Object Storage, Yandex Function,
  external Telegram configuration and **Dexie Cloud data** are not migrated.
  True disaster recovery/data portability needs a separate backup/import plan.
- A new worker URL/custom domain may require separate explicit DNS or routing
  configuration; bootstrap does not touch domain zones or DNS.
- The media bucket has CORS but no public read URL, publicly writable policy,
  DNS binding or media playback implementation. A later reviewed read fallback
  must define its public-read/privacy and HTTP Range contract explicitly.
- The historical D1 migration list includes duplicate numeric prefixes
  `0014` and `0029` (audit A-011). The bootstrap executes the **current
  filenames** using Wrangler's migration tracking; it does not rename or
  edit already-deployed SQL. Audit resolution/owner decision remains separate.
- Unlike migrations, `wrangler deploy` automatically publishes the Worker
  and Durable Object migrations in existing `wrangler.jsonc`; no existing
  Cloudflare Worker code/schema is silently regenerated.

## Relevant Cloudflare documentation

- https://developers.cloudflare.com/api/resources/d1/
- https://developers.cloudflare.com/api/resources/r2/
- https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/cors/
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/
- https://developers.cloudflare.com/workers/configuration/secrets/
