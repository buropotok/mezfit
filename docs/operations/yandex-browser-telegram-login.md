# Browser Telegram Login on the existing MezFit Yandex gateway

## Browser popup rollout

The [official Telegram Login JS library](https://core.telegram.org/bots/telegram-login#using-the-telegram-login-library) returns an ID token to the browser. The SPA sends it via same-origin `POST /auth/callback`. The private function verifies `RS256`, issuer, audience, expiry, issue time, numeric Telegram identity and the nonce from `POST /auth/start`. It then issues the existing host-bound `__Host-mz_browser_session` cookie. The popup flow has no server-side `/token` request. The legacy GET methods support rollback and the previous SPA build.

The function uses only the official Telegram HTTPS JWKS. A warm instance keeps keys for at most five minutes and refreshes for an unknown signing key after a short minimum interval. An expired cache is never used when fetching keys fails. After validating a five-minute challenge and its token, the function atomically creates an empty marker containing only a SHA-256 digest in its key, using `If-None-Match: *`. A duplicate marker or failed write denies the login across function instances. The private nonce bucket expires markers through a one-day lifecycle rule. Browser retries request a fresh challenge.

### Release and rollback

1. In [Prepare MezFit Browser Telegram Login](https://github.com/buropotok/mezfit/actions/workflows/prepare-mezfit-browser-login.yml) on `main`, run `action=popup`, `mode=preview`, with an empty `confirm`. The operator checks the active diagnostics version and gateway contract. If a nonce bucket already exists, it checks ownership, private access, the expiration rule and the policy. Preview makes no writes.
2. Run `action=popup`, `mode=apply`, `confirm=ENABLE_MEZFIT_BROWSER_LOGIN_POPUP`. The existing deploy service account needs permission to create the dedicated bucket, set its lifecycle and policy, and read these settings. The operator creates the separate private bucket and grants conditional `PutObject` under `used/` to the existing runtime service account through the bucket policy. The function uses a short-lived IAM token from its invocation context. Lockbox and folder-wide grants are left alone. The operator preserves the diagnostics version under `browser-login-pre-popup`, activates the reviewed version, and adds two POST methods to the current Gateway.
3. After successful backend readback, run [Publish MezFit SPA to Yandex](https://github.com/buropotok/mezfit/actions/workflows/publish-yandex-spa.yml) with `PUBLISH_MEZFIT_WEB`. Use a normal browser on a BotFather-approved origin. Check Android Chrome, iOS Safari and desktop, including blocked or closed popups, retry, success, reload, logout and Mini App login. If a script policy is configured, allow the Telegram SDK from `https://oauth.telegram.org`. An opener that sets COOP needs `same-origin-allow-popups` for this login page.
4. A failed sign-in displays sanitized `stage`, `code`, an optional `httpStatus` and `incidentId`. `jwks: timeout` means Yandex did not receive the keys in time. `jwt` means verification rejected the token. `challenge` identifies the one-time attempt or storage validation. The first real sign-in after publishing checks live reachability from the function. The diagnostics contain no JWT, authentication code, cookie, credentials or user data.
5. To roll back, run `action=popup-rollback`, `mode=preview`, then `mode=apply`, `confirm=ROLLBACK_MEZFIT_BROWSER_LOGIN_POPUP`. This removes the two POST methods and restores the verified diagnostics version. An already-published SPA uses the original flow when the popup endpoint responds with HTTP 404/405. The private bucket remains in place and its lifecycle rule expires markers. Browser identity still gives no access to `/api/*` or Dexie Cloud.

### Nonce bucket recovery after HTTP 403

If Preview reports `Read private nonce bucket (preflight): HTTP 403`, ask a
Yandex Cloud operator with permission to view and edit the bucket policy to
open the bucket named in the error under **Object Storage → Security → Access
policy**. If the policy contains only the original runtime statement granting
conditional `s3:PutObject` under `used/`, append the following statement to
the existing `Statement` array. Substitute the workflow variable
`YC_DEPLOY_SA_ID` and the exact bucket name from the error.

```json
{
  "Effect": "Allow",
  "Principal": {"CanonicalUser": ["<YC_DEPLOY_SA_ID>"]},
  "Action": [
    "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLocation",
    "s3:GetBucketVersioning", "s3:GetBucketWebsite",
    "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration"
  ],
  "Resource": ["arn:aws:s3:::<bucket-name>"],
  "Condition": {"Bool": {"aws:SecureTransport": "true"}}
}
```

Save the policy and run popup Preview again. Proceed to Apply when Preview
passes. If the operator cannot inspect the policy, the policy differs from
the expected runtime-only policy, or Preview still returns 403, inspect
deployment IAM and bucket access before changing any settings.

## Original redirect flow

**Scope:** a real Telegram OpenID Connect (OIDC) browser login flow on
`https://mezfit.online`, `https://mezfit.ru`, and the existing technical
`*.apigw.yandexcloud.net` hostname, using a private Yandex Cloud Function.

**Important functional limit:** The new server authenticates a **browser
identity only**. It creates a secure browser session and validates
`/auth/session`, but does **not** issue Telegram Mini App `initData`,
Dexie Cloud tokens, roles, or permission to call any existing `/api/*` route.
All existing Yandex `/api/*` requests still explicitly return 503 until the
separate privileged backend migration. The browser screen therefore displays
the confirmed identity plus a clear note that full product access remains
inside Telegram Mini App. **Do not present this as completed browser access
to Coach/Client data.**

## Official specifications

- [Telegram Login (OIDC, authorization code + PKCE)](https://core.telegram.org/bots/telegram-login)
- [Yandex API Gateway cloud_functions integration](https://yandex.cloud/en/docs/api-gateway/concepts/extensions/cloud-functions)
- [Yandex Cloud Functions Node.js 22](https://yandex.cloud/en/docs/functions/lang/nodejs/)
- [Yandex Function CreateVersion + pinned Lockbox secrets](https://yandex.cloud/en/docs/functions/functions/api-ref/Function/createVersion)
- [Yandex Function access bindings](https://yandex.cloud/en/docs/functions/functions/api-ref/Function/updateAccessBindings)
- [Yandex IAM service-account creation](https://yandex.cloud/en/docs/iam/api-ref/ServiceAccount/create)
- [Yandex Lockbox secret creation](https://yandex.cloud/en/docs/lockbox/api-ref/Secret/create)
- [Yandex Lockbox access bindings](https://yandex.cloud/en/docs/lockbox/api-ref/Secret/updateAccessBindings)

## Architecture

Browser / public web address
→ **existing** `mezfit-web` Yandex API Gateway
→ four additional `/auth/*` routes
→ private `mezfit-browser-login` Node.js 22 Cloud Function
→ Telegram `https://oauth.telegram.org` token/JWKS endpoints.

The function implements:

- `GET /auth/start`: creates cryptographically random `state`, `nonce` and
  PKCE S256 verifier, stores them in a signed 10-minute
  `__Host-` cookie and redirects to Telegram authorization.
- `GET /auth/callback`: checks cookie Host binding, expiration, signed state,
  exchanges a one-time code **server-side** with BotFather's OIDC Client
  Secret, validates Telegram's **RS256** JWT using its JWKS keys plus issuer,
  audience, nonce, issued/expiry times and numeric Telegram user ID.
  Issues a 12-hour host-bound, HMAC-SHA256-signed browser-session cookie;
  the raw Telegram ID token and access token are not retained.
- `GET /auth/session`: validates the signed HttpOnly Secure SameSite=Lax
  cookie and returns only identity fields (not tokens or backend permissions).
- `POST /auth/logout`: rejects cross-origin POST and expires both cookies.

Security: explicitly allowlisted Hosts; no cross-origin API/CORS; no
client-side OIDC secret; no browser-access to D1 or Dexie Cloud on the strength
of an OIDC session alone. The Cloud Function is **not public**; API Gateway
invokes it using only the existing deployment service account's
`functions.functionInvoker` role on that specific function. The operator
rejects a function granting `allUsers` or `allAuthenticatedUsers` access.

The original Telegram Mini App uses its own cryptographically checked
`initData` through the existing Worker. There is no shim that forges
`initData` from a browser cookie; neither authentication channel weakens
the other. Dexie Cloud remains the canonical business database, and no new
business data is created by this PR.

## Required one-time owner setup BEFORE Apply

1. Open **@BotFather → @mezfit_bot → Login Widget / Web Login**. Register
   all browser origins and **exact redirect URLs** intended for sign-in.
   For the technical Yandex Gateway address (from successful Prepare):
   - `https://d5dnrvd45b0b0s0u95g3.3zvepvee.apigw.yandexcloud.net`
   - `https://d5dnrvd45b0b0s0u95g3.3zvepvee.apigw.yandexcloud.net/auth/callback`
   For custom domains, once HTTPS works:
   - `https://mezfit.online` and `https://mezfit.online/auth/callback`
   - `https://mezfit.ru` and `https://mezfit.ru/auth/callback`

   Take the **OIDC Client ID and OIDC Client Secret** from BotFather. The
   Client Secret is **not** the existing Telegram Bot API token. Configure
   BotFather to issue **RS256**-signed ID tokens (the default).

2. In GitHub [repository Actions Variables](https://github.com/buropotok/mezfit/settings/variables/actions),
   create **one non-secret variable**:
   - `TELEGRAM_LOGIN_CLIENT_ID` = `8635045061` (decimal ID from BotFather).

   Under [Actions Secrets](https://github.com/buropotok/mezfit/settings/secrets/actions),
   create **one repository secret**:
   - `TELEGRAM_LOGIN_CLIENT_SECRET` = Client Secret from BotFather.

   Never paste the secret into repository files, workflow inputs, Actions
   Variables, an issue, pull request or chat. GitHub only provides this value
   to the owner-only `prepare` / `apply` job; the script transmits it
   directly over HTTPS to Yandex Lockbox, without logging it. The source
   service account receives a short-lived Yandex IAM token from GitHub OIDC.

3. **No manual Cloud Functions, Lockbox, or service-account creation.**
   Owner-confirmed `prepare` / `apply` performs these steps itself:

   - Creates/reuses a dedicated `mezfit-browser-auth-runtime` service
     account in the existing folder `b1g774t6sgop4rakjob7`;
   - Creates/reuses the deletion-protected `mezfit-browser-telegram-oidc`
     Lockbox secret, initially containing `client_id`, `client_secret`,
     and a **separately generated random `session_secret`**;
   - Retrieves the **current version ID from Lockbox metadata** (never a
     moving `latest`), without fetching secret payload;
   - Grants only `lockbox.payloadViewer` on that one secret to the
     dedicated runtime account;
   - Creates/reuses the private login function and assigns
     `functions.functionInvoker` only to the original
     `mezfit-github-deploy` account that API Gateway uses.

   Rerunning Apply is idempotent: it neither replaces an existing secret
   nor rotates a session key. To rotate Telegram credentials later, use a
   separately reviewed, explicit rotation procedure.

4. **The only possible Yandex-side prerequisite is the IAM bootstrap.**
   The existing `mezfit-github-deploy` service account must already have
   sufficient permissions to create the runtime account, protect the
   secret, and install the function-specific bindings:

   - `iam.serviceAccounts.admin` scoped to the target folder;
   - `lockbox.admin` scoped to the target folder for initial secret
     creation **and permission assignment**;
   - `functions.admin` scoped to the target folder for Cloud Functions
     and their IAM bindings;
   - Existing `api-gateway.editor` remains necessary for route activation.

   **This is an IAM bootstrap, not manual secret entry.** GitHub Actions
   cannot grant itself missing permissions: if the deployment SA does not
   have the roles, the action fails with HTTP 403 and the folder owner
   must grant them once. The `lockbox.admin` role itself can read secret
   payloads, so it should be **removed from the deployment SA after
   successful initial provisioning** if subsequent first-time setup is not
   needed. The script deliberately never fetches the payload.

   No `YC_LOGIN_RUNTIME_SA_ID`, `YC_LOGIN_LOCKBOX_ID` or
   `YC_LOGIN_LOCKBOX_VERSION_ID` repository variables are required.
   All three identifiers are resolved from Yandex Cloud's metadata on each
   invocation. Existing `YC_FOLDER_ID` and `YC_DEPLOY_SA_ID` remain
   unchanged.

## Safe rollout: Preview / Apply

Workflow: `Prepare MezFit Browser Telegram Login`
(`.github/workflows/prepare-mezfit-browser-login.yml`).

Only repository owner on `main` may dispatch. Existing GitHub OIDC is
used to acquire a short-lived IAM token. No static Yandex API key is stored.

| Action | Mode | Exact Apply confirmation | Effect |
| --- | --- | --- | --- |
| `prepare` | `preview` | none | Read existing gateway, runtime account, Lockbox and function metadata; plan without secrets or writes |
| `prepare` | `apply` | `PREPARE_MEZFIT_BROWSER_LOGIN` | Bootstrap private runtime account + protected Lockbox from GitHub Secret, scope Lockbox access, create/reuse private function and pinned Node 22 version; **no Gateway update** |
| `activate` | `preview` | none | Check ACTIVE exact function, secrets, original gateway spec, and four routes |
| `activate` | `apply` | `ACTIVATE_MEZFIT_BROWSER_LOGIN` | PATCH the **existing** gateway `openapiSpec`, add only four `/auth/*` routes, preserve `/api/*` dummy 503, static SPA and attached domains |
| `upgrade` | `preview` | none | Inspect only: verify exact deployed auth baseline, approved gateway and pinned Lockbox, and plan diagnostics version switch |
| `upgrade` | `apply` | `UPGRADE_MEZFIT_BROWSER_LOGIN_DIAGNOSTICS` | Retain baseline version under `browser-login-pre-diagnostics`, publish reviewed diagnostics version without serving tag, verify configuration, then move only `browser-login` tag; no Gateway, Secret or SPA changes |

All write phases are separately and explicitly confirmed. Readback checks
require exact source SHA-256, function runtime, entrypoint, service account,
pinned secret IDs/key mappings, separate runtime service account, and gateway integration. A missing IAM role
fails without relaxing policy and requires the owner to grant the minimum bootstrap permissions. A pre-existing gateway modification blocks
activation rather than overwriting it. Function configuration drift blocks
automatic upgrade until explicitly reviewed.

After merging the PR and activating the four routes, run the existing
`Publish MezFit SPA to Yandex` workflow with
`PUBLISH_MEZFIT_WEB` **again**, so the new browser-login React screen
is actually served on Yandex. Cloudflare deploy continues separately.

## Diagnosing TELEGRAM_LOGIN_VERIFICATION_FAILED after callback

If Telegram redirects back to `/auth/callback` but the page displays
`TELEGRAM_LOGIN_VERIFICATION_FAILED`, the earlier deployment returns one
generic error regardless of whether the Yandex runtime can reach Telegram.
**Do not assume Cloudflare/network restrictions or replace the OIDC Client
Secret without collecting evidence.**

The reviewed diagnostics are installed only after an additional explicit
operator run:

1. Merge the diagnostics PR after the required review and successful CI.
2. Open the owner-only
   [Prepare MezFit Browser Telegram Login workflow](https://github.com/buropotok/mezfit/actions/workflows/prepare-mezfit-browser-login.yml)
   on `main`. Select `action=upgrade`, `mode=preview`, empty confirmation.
   Confirm that the currently served `browser-login` version matches the pinned
   baseline established by successful Prepare Apply run
   [45107553050](https://github.com/buropotok/mezfit/actions/runs/45107553050).
   An unexpected version or modified Gateway blocks the upgrade — never force.
3. Repeat with `action=upgrade`, `mode=apply` and the exact confirmation
   `UPGRADE_MEZFIT_BROWSER_LOGIN_DIAGNOSTICS`.
4. The operator first tags the original version
   `browser-login-pre-diagnostics` for safe rollback, publishes and strictly
   verifies a new unserved version with **the same runtime account, pinned
   Lockbox version and host allowlist**, and only then moves the serving
   `browser-login` tag. It reuses an already verified untagged candidate
   after an interrupted run. No secrets are read or rotated, and the SPA
   does not need to be republished.
5. On the same Yandex technical origin, open `/`, click
   **Войти через Telegram**, and confirm in Telegram. If authorization fails,
   the callback **JSON body directly displays** `stage`, `code`, optional
   numeric `httpStatus`, and a random `incidentId` (16 URL-safe characters).
   **This is sufficient for triage without Yandex Cloud log access.** Share
   only these four diagnostic fields, NOT the callback URL, authorization
   `code`, cookies, client secret or ID token.
6. If Cloud Function logs are available, optionally view logs for
   `mezfit-browser-login`, ID `d4ekc6o3om4qkrb88gpg`, in
   [Yandex Cloud Functions console](https://console.yandex.cloud/) →
   Cloud Functions → function → Logs, filtered to the test time;
   search for `mezfit.browser_oidc.failure` and the exact `incidentId`.
   Official instructions:
   [Viewing the function execution log](https://yandex.cloud/en/docs/functions/operations/function/function-logs).
   Equivalent Yandex CLI command for an authorized operator:
   `yc serverless function logs d4ekc6o3om4qkrb88gpg --tag browser-login`.

The log contains **only** a structured, allowlisted
`event`, `incidentId`, `stage`, `code` and optional numeric
`httpStatus`. It never writes error messages, request/response bodies,
Authorization headers, Telegram code, ID token, credentials, nonce, state,
cookies, host, user identity or IP.

| Stage | Safe codes | Interpretation |
| --- | --- | --- |
| `token` | `dns`, `connect`, `timeout`, `tls`, `network` | Yandex Function could not complete the outbound Telegram token request. This supports a network/TLS cause; investigate Yandex egress/DNS and upstream reachability. |
| `token` | `http_error`, `httpStatus` (e.g. 400/401) | Telegram answered. Check BotFather **OIDC** Client Secret, callback allowlist, code verifier and client registration; the HTTP status alone does not identify which credential or request field is wrong. |
| `token` | `missing_id_token`, `invalid_json`, `response_too_large`, `body_read_failure` | The token exchange returned unusable content or failed during response reading. |
| `jwks` | `dns`, `connect`, `timeout`, `tls`, `network`, `http_error` | Token endpoint responded, but obtaining verification keys failed at a separate request. |
| `jwks` | `invalid_keys`, `matching_key_not_found`, `invalid_public_key` | Telegram key payload or expected signing key is incompatible or absent. |
| `jwt` | `invalid_token`, `unsupported_algorithm`, `signature_check_failure`, `invalid_signature`, `invalid_claims` | Token received; signature, format, signing algorithm or verified claims failed. |
| `internal` | `unclassified` | Other server-side exception; no speculative diagnosis. |

The public HTTP response **still returns 401** with the generic
`TELEGRAM_LOGIN_VERIFICATION_FAILED` error, the random non-authorizing
`incidentId`, and the **same fixed safe `stage` / `code` / optional
numeric `httpStatus`**. No access to Yandex logs is needed to read these
diagnostics. Example of a Telegram HTTP rejection:

```json
{
  "error": "TELEGRAM_LOGIN_VERIFICATION_FAILED",
  "incidentId": "<random URL-safe ID>",
  "stage": "token",
  "code": "http_error",
  "httpStatus": 401
}
```

The example is illustrative, not the observed cause. Neither the browser
response nor server logs contain upstream text, response bodies, secrets,
credentials, Telegram authorization code, id_token, nonce/state or identity.
A successful login does not emit a failure log.

**Important:** This verifies the cause of a fresh failed request after the
diagnostics release; previous error instances cannot be retroactively
diagnosed. A network error proves only that the Function's outbound
connection failed, not that Telegram specifically blocked Yandex.
If an HTTP status or a JWKS/JWT code is logged, the next fix must target that
specific path, not an assumed network ban.

### Returning to the previous code

The operator retains the exact previous function version under
`browser-login-pre-diagnostics`. If the diagnostics release causes an
unexpected regression, do not rotate Lockbox or revert Gateway spec.
The owner must explicitly review and approve a separate rollback operation
that reassigns `browser-login` to the retained version. Do not silently
roll back or reapply a different source digest.

## Smoke checks

1. On `https://<Yandex gateway domain>/` outside Telegram, verify that
   the browser screen shows **Войти через Telegram** only if
   `GET /auth/session` returns 401 JSON (active Yandex function).
   If no backend is active, the original Mini App guidance remains.
2. Click login, approve in Telegram, verify that the browser returns to
   the same host and displays the confirmed Telegram identity.
3. Confirm `/auth/session` returns 200 JSON after success and 401 after
   logout, without exposing any tokens in the page.
4. Verify that an unauthorized Host, a forged state, a wrong OIDC signature,
   an expired token, and cross-origin logout all fail.
5. Confirm that the existing Telegram Mini App continues to authenticate via
   signed `initData` and no Yandex `/api/*` route was opened.
6. Repeat against `mezfit.online` and optionally `mezfit.ru` only when
   their NS and issued TLS certificates are active.

## Compatibility and outstanding work

This is the **identity foundation**, not an end-to-end product API migration.
The next explicit backend slice must authorize browser-session credentials
inside Yandex (and issue appropriately scoped Dexie Cloud tokens) independently
of Telegram initData, preserving existing realm/role checks. It must also
migrate the remaining protected endpoints and media flows before the browser
can run all Coach/Client screens. This PR intentionally contains no temporary
Cloudflare Worker proxy, no cross-origin cookies, no fake initData, no
client-side trust escalation, and no new authoritative database.

Tests: Python stdlib operator tests (including IAM/Lockbox bootstrap) are discovered by existing CI; the
additional `node --test` contract is executed in GitHub PR CI using Node 22;
frontend session parsing has a Vitest contract. AGENTS.md prohibits local
npm/typecheck/test/build and those were not run before PR.
