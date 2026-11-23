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

2. In **Yandex Lockbox**, create one secret (e.g.
   `mezfit-browser-telegram-oidc`) in folder
   `b1g774t6sgop4rakjob7` with three payload keys:
   - `client_id`: decimal Telegram OIDC Client ID;
   - `client_secret`: BotFather OIDC Client Secret;
   - `session_secret`: an independent cryptographically random 32-byte
     base64url string (for example generate locally via
     `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`).

   Do not place these values in GitHub files, workflow inputs, repository
   secrets/variables, public pages, or chats. Never reuse the bot token as
   `client_secret` or the session HMAC key. Pin the **exact Lockbox
   version ID**, not a moving `latest`.

3. Create a **separate least-privilege runtime service account** in the
   same Yandex folder (for example `mezfit-browser-auth-runtime`). Grant
   this account **`lockbox.payloadViewer` on the single new Lockbox secret
   only**. It needs no DNS, Gateway, GitHub, D1 or Dexie roles.

   The existing deployment service account (`mezfit-github-deploy`,
   id `ajeijn4c6747d0l7dmel`) should have the scoped permission to
   create function versions and add the function's narrow
   `functions.functionInvoker` binding (appropriate Cloud Functions
   administration rights). **Do not grant this deployment account
   Lockbox payload access.** The deployment workflow passes only secret
   metadata, never the contents. Do not grant public function invocation.

4. Create three **non-secret GitHub Actions repository variables**:
   - `YC_LOGIN_RUNTIME_SA_ID`: the ID of the dedicated runtime service account.
   - `YC_LOGIN_LOCKBOX_ID`: the Lockbox secret ID (not any payload value).
   - `YC_LOGIN_LOCKBOX_VERSION_ID`: the pinned Lockbox secret version ID.

   Existing `YC_FOLDER_ID` and `YC_DEPLOY_SA_ID` stay unchanged.

## Safe rollout: Preview / Apply

Workflow: `Prepare MezFit Browser Telegram Login`
(`.github/workflows/prepare-mezfit-browser-login.yml`).

Only repository owner on `main` may dispatch. Existing GitHub OIDC is
used to acquire a short-lived IAM token. No static Yandex API key is stored.

| Action | Mode | Exact Apply confirmation | Effect |
| --- | --- | --- | --- |
| `prepare` | `preview` | none | Read existing gateway/function/secret version metadata, plan the change |
| `prepare` | `apply` | `PREPARE_MEZFIT_BROWSER_LOGIN` | Create/reuse private function; exact gateway SA invoker binding; pinned Lockbox Node 22 version with tag `browser-login`; **no Gateway update** |
| `activate` | `preview` | none | Check ACTIVE exact function, secrets, original gateway spec, and four routes |
| `activate` | `apply` | `ACTIVATE_MEZFIT_BROWSER_LOGIN` | PATCH the **existing** gateway `openapiSpec`, add only four `/auth/*` routes, preserve `/api/*` dummy 503, static SPA and attached domains |

All write phases are separately and explicitly confirmed. Readback checks
require exact source SHA-256, function runtime, entrypoint, service account,
pinned secret IDs/key mappings, separate runtime service account, and gateway integration. A missing IAM role
fails without relaxing policy. A pre-existing gateway modification blocks
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

Tests: Python stdlib operator tests are discovered by existing CI; the
additional `node --test` contract is executed in GitHub PR CI using Node 22;
frontend session parsing has a Vitest contract. AGENTS.md prohibits local
npm/typecheck/test/build and those were not run before PR.
