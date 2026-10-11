# Telegram invite acceptance backed by Dexie Cloud

The existing **Подключиться к тренеру** action uses
`POST /api/invite/current/accept`. It does not expose a second button or
require an administrative CLI run from a user.

## Server-side flow

1. Worker validates signed Telegram `initData`; client IDs in the request
   are never used as identities.
2. Worker validates the stored invitation and gets the coach's Telegram ID
   from the persisted server-side coach record.
3. The existing single-use D1 invitation is atomically reserved for the
   verified client. A different client cannot consume the same invite in a
   concurrent request; the same client may retry.
4. A dedicated privileged Worker service creates or validates one deterministic
   relationship realm and accepted coach/client memberships in **Dexie Cloud**.
   All realm/member owners are explicitly `null`; only global roles
   `coach` and `client` are accepted. Existing unexpected records or
   role overrides stop the operation rather than being overwritten.
5. The service verifies both memberships with **user-scoped** tokens.
6. Only after cloud success, Worker creates the **temporary D1 legacy
   read-model** row `coach_client` so existing D1-backed Coach/Client
   screens still function. This is not a separate cloud sync engine;
   normal PLAN/FACT business writes are not duplicated.

If cloud provisioning fails or the legacy projection write fails, retry the
**same Telegram invitation**. Reservation belongs to that specific Telegram
user and the cloud operation is idempotent. No separate manual Dexie-accept
operation exists. A cloud outage does not create an active D1 relationship.

The temporary D1 `coach_client` representation must be removed when its
consumers are migrated to typed Dexie Cloud repositories. During the
transition Dexie Cloud membership is the authority for *new* relationships,
while legacy features still require the D1 projection for their current
authorization/read paths. This is a deliberate compatibility boundary, not
a general-purpose bidirectional replication design.

## Two distinct backend credentials

Keep the existing auth service credentials:

- `DEXIE_CLOUD_CLIENT_ID`
- `DEXIE_CLOUD_CLIENT_SECRET`

These should have only `ACCESS_DB,IMPERSONATE`. Their end-user tokens
have only `ACCESS_DB`.

Provision a **separate** service client with exactly
`ACCESS_DB,GLOBAL_READ,GLOBAL_WRITE` (without `IMPERSONATE`).
Store it only in the Cloudflare Worker secret store:

- `DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID`
- `DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET`

For example, from an authenticated deployment environment:

```sh
npx wrangler secret put DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID
npx wrangler secret put DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET
```

Do not commit these secrets, do not reuse or broaden the Telegram token
service account, and do not provide the management key to the frontend.
The backend exposes no generic administrative Cloud API: only the existing
verified invitation action can trigger provisioning, for identities derived
from server-validated Telegram state and invitation records.

**Rollout dependency:** Until both membership secrets are configured,
the button returns `503 CLOUD_MEMBERSHIP_NOT_CONFIGURED` and no active D1
relationship is created. This is intentional fail-closed behavior. The
frontend shows the ordinary invite error and leaves the same invite
available for retry. Do not activate this release expecting Cloud membership
to work before the credentials are installed.

## Verification

After deployment and secret configuration, create a fresh invitation in
Telegram, accept it as a different Telegram user, then verify from an
administrative Dexie Cloud context that the deterministic realm exists,
both memberships have `owner: null`, their `roles` are correct,
and neither user has global scopes. Verify idempotent retry, forbidden
cross-user access, and PLAN/FACT permissions against the live service
before migrating domain repositories.

The current one-use D1 invitation lifecycle and D1-backed program/Workout
runtime are not migrated by this PR. The client-owned personal PLAN/Workout
read-sharing model is a separate domain migration and **is not granted** by
the coach-client membership role itself.
