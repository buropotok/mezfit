# Browser Telegram Login on the existing MezFit Yandex gateway

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
