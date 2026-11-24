# Telegram JWKS mirror: isolated Cloudflare Cron -> Yandex Object Storage

The dedicated Cloudflare Worker publishes Telegram JWKS to a private Yandex bucket.
The Yandex browser-login function can use that mirror for its popup callback.

## Purpose and trust boundary

The standalone Worker `mezfit-telegram-jwks-mirror` fetches the fixed official Telegram OIDC keyset from
`https://oauth.telegram.org/.well-known/jwks.json` on a one-minute Cron Trigger. It validates
RSA / RS256 signing-key metadata, rejects duplicate `kid`, and canonicalizes the keyset.
The Worker uses its **own S3 identity**, authorized only on one new private Yandex bucket:

- Bucket: `mezfit-telegram-jwks-b1g774t6sgop4rakjob7`
- `jwks.json`: overwritten only when the canonical keyset changes
- `status.json`: updated following each successful Telegram fetch and storage reconciliation;
  contains `checkedAt`, `changedAt`, `kids`, and a digest of the published keyset

Both objects are **private**. The browser-login runtime can read the bucket using a
short-lived Yandex IAM token and a bucket-scoped `storage.viewer` grant.
Popup verification uses the existing server-side checks for RS256, `kid`, issuer,
audience, nonce, token lifetime, and replay protection after validating the mirror
heartbeat and digest. No JWT or user data is transmitted to the mirror Worker.

The Worker rejects ordinary HTTP requests (404). Only the Cron invokes the refresh.
Invalid, unavailable, or oversized Telegram responses never replace last-known-good keys;
a failed publish never advances the heartbeat. Cloudflare logs contain a small event/code,
never S3 access keys, JWTs, or raw upstream data. No fresh-key/fresh-login guarantee is made
until the mirror, reader permissions and Yandex-to-bucket connectivity have been verified.

## Resources, credentials and blast radius

GitHub Actions already has the `YC_DEPLOY_SA_ID`, `YC_FOLDER_ID` repository variables and
a GitHub OIDC -> short-lived Yandex IAM token exchange. It also uses `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` for Cloudflare deployments. The owner has indicated that the
deployment account is provisioned with `iam.serviceAccounts.admin`,
`iam.serviceAccounts.accessKeyAdmin` and `storage.admin` in folder
`b1g774t6sgop4rakjob7`; actual API permissions are verified only during Apply.

The owner-only workflow creates an independent `mezfit-jwks-publisher` service account,
an isolated private bucket (no anonymous read, list, or config), and a
**bucket-scoped** `storage.uploader` IAM grant. This runtime grant includes read and
overwrite capabilities on that bucket: the Worker must read `jwks.json` and
`status.json` to compare changes. It cannot access other buckets by this grant.
Folder-wide `storage.admin` is assigned only to the existing GitHub deployment
principal for initial provisioning, not to the Worker identity.

The `activate` step mints **one** Yandex S3 access key for the publishing account.
It is held only in the runner's mode-0600 temporary file and uploaded to Cloudflare
through `wrangler deploy --secrets-file`. It is not printed, committed, or written into
a GitHub Secret. The file is removed using an unconditional `always()` cleanup step.
The Worker therefore trusts Cloudflare, the Telegram HTTPS endpoint and bucket integrity.
Compromise of the Worker or its S3 key can replace trusted JWKS; account isolation,
small access scope and manual key rotation are mandatory. This is a long-lived
credential; unlike the GitHub -> Yandex deployment token, it does not auto-expire.

## Deployment procedure (after PR merge + CI/review)

Workflow: **Prepare Telegram JWKS Mirror**
(`.github/workflows/prepare-telegram-jwks-mirror.yml`). Only the repository owner
on `main` can dispatch it. All writes are manual and require action-specific
literal confirmation. The PR itself does not perform live infrastructure changes.

1. Run `action=prepare`, `mode=preview`, blank confirmation. It inspects only Yandex
   resources and permissions. Stop on unexpected existing bucket, ACL or IAM drift.
2. Run `action=prepare`, `mode=apply`,
   `confirm=PREPARE_MEZFIT_JWKS_MIRROR`. It creates/reuses the private bucket and
   publisher, adds only the expected bucket IAM grant, and validates the readback.
   This phase creates **no S3 access key** and deploys no Cloudflare code.
3. Run `action=activate`, `mode=preview` and inspect the one-time key/deployment plan.
4. Run `action=activate`, `mode=apply`,
   `confirm=ACTIVATE_MEZFIT_JWKS_MIRROR`. The workflow preflights Cloudflare API
   access, mints one S3 key, and deploys **only** the separate Worker using its
   own Wrangler config. The existing `mezfit` Worker, its Cron, D1, R2 and assets
   are unchanged.
5. Confirm Cloudflare scheduled invocations are succeeding. Confirm private
   `jwks.json` and `status.json` exist using an authorized Yandex operator, that
   `checkedAt` advances, and that `changedAt` advances only when the keyset changes.
   Test an intentional invalid Telegram response or failed storage write with
   mocks: last good `jwks.json` must not be overwritten and a failed run must not
   show successful freshness. Confirm anonymous GET receives AccessDenied.
6. Review daily the elapsed time since `checkedAt`, key-set changes and Cloudflare
   cron errors. One-minute scheduling is best effort, not a real-time guarantee.
   Continue collecting rotation statistics before changing the interval.

### Safe code-only Worker upgrade (after first successful activation)

A deployed Worker must never be upgraded by repeating `activate/apply`: its Yandex
static S3 credential is a one-time secret and cannot be read back from Yandex.
Use **the same owner-only** `Prepare Telegram JWKS Mirror` workflow on `main`:

1. `action=upgrade`, `mode=preview` (blank confirmation): read-only check
   that the private bucket has the approved IAM contract and that exactly
   **one** publisher S3 key exists.
2. `action=upgrade`, `mode=apply`,
   `confirm=UPGRADE_MEZFIT_JWKS_MIRROR`: preflight that the independent
   Cloudflare Worker **already exists**, then redeploy its code with Wrangler
   and **without** `--secrets-file` or any Yandex key creation.
3. Wrangler verifies both required Cloudflare secret bindings are present;
   existing secrets remain encrypted and unchanged during the code-only deploy.
4. Inspect Cloudflare Cron Events / Workers Logs, then verify `jwks.json` and
   `status.json` in the private bucket. Cron propagation can take up to
   15 minutes after trigger installation or changes.

For the initial bootstrap, the Worker previously rejected Yandex static S3
key IDs containing `-`, even though those are valid characters. This was
fixed independently of the key and bucket; existing credentials should be reused.

### Switch browser popup verification to the mirror

Use **Prepare MezFit Browser Telegram Login**
(`.github/workflows/prepare-mezfit-browser-login.yml`) after the mirror is publishing and
the popup routes are active. Run `popup-mirror` in `preview` first, then in `apply`
with `ENABLE_MEZFIT_BROWSER_JWKS_MIRROR`. Both modes check the bucket settings, direct
IAM bindings, and the current heartbeat and key set. Apply installs the read grant,
publishes the function version, and moves the existing `browser-login` tag.

Test a new browser sign-in after Apply to exercise the function's runtime identity.
The popup refreshes its in-memory key set at least once per minute while serving
login requests, sooner for an unfamiliar key ID, and expires it when the
last successful publisher check reaches five minutes. The previous authorization
code route retains its Telegram endpoints. For rollout failure, the existing
`popup-rollback` action restores the diagnostics version and removes the popup POST routes.

### Empty bucket troubleshooting

A green GitHub Actions run proves the requested *operator action* finished,
not that the background Worker executed. `prepare/apply` creates only
the bucket and publisher; `activate/apply` first deploys the Worker.

In Cloudflare Dashboard -> Workers & Pages -> `mezfit-telegram-jwks-mirror`,
check Cron Triggers, Cron Events and Workers Logs for
`jwks_mirror_ok` or `jwks_mirror_failed`. `CONFIG_INVALID` means a
mismatched bucket/key/secret binding; `TELEGRAM_FETCH_FAILED` or
`FETCH_HTTP_...` means retrieval failed; `JWKS_WRITE_HTTP_403` or
`STATUS_WRITE_HTTP_403` means Yandex S3 rejected writes.
Never paste S3 secret values or `Authorization` headers into GitHub issues,
Cloudflare logs or chats. Do not add a public test route or relax bucket IAM
merely to debug.

**Important one-shot recovery rule:** If `activate` creates a key but deployment fails,
a second activation **fails closed** when any key already exists. The one-time secret
cannot be retrieved from Yandex. An operator must inspect Cloudflare and Yandex,
explicitly revoke the orphaned key after review, then rerun Preview/Apply.
Do not silently mint a second key, widen privileges, or log a secret to recover.
Subsequent code updates/credential rotation require an independently reviewed
operator procedure; this bootstrap workflow is intentionally not a rotation API.

## Implementation and tests

- `tools/jwks-mirror/worker.mjs`: fixed upstream, bounded JWKS, SigV4 S3 GET/PUT,
  canonical change detection and heartbeat after successful publication
- `tools/jwks-mirror/wrangler.jsonc`: independent Cron worker; no publicly deployed route
- `tools/yandex-infrastructure/jwks_mirror.py`: read-only Preview, controlled Apply,
  scoped IAM readback, one-time credentials
- `tools/yandex-infrastructure/test_jwks_mirror.py` and
  `tools/jwks-mirror/worker.node-contract.mjs`: offline operator/security contracts
- `.github/workflows/ci.yml`: invokes the new Node contract alongside the existing
  Yandex Python operator suite; other CI checks continue unchanged

Key refreshes are published directly to Yandex Object Storage by the Cron Worker.

External references:

- https://oauth.telegram.org/.well-known/jwks.json
- https://yandex.cloud/en/docs/iam/awscompatibility/api-ref/AccessKey/create
- https://yandex.cloud/en/docs/storage/api-ref/Bucket/updateAccessBindings
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
