# Dexie Cloud foundation — deployment and security checklist

Status: **foundation only**. The current Coach/Client runtime still uses D1-backed APIs,
the existing local Dexie cache and custom SyncEngine. No old data is pushed to Dexie
Cloud by this change. Do not interpret this PR as the completed migration.

## Public configuration

- Database: `https://zjv60oxag.dexie.cloud` in root `dexie-cloud.json`.
- `src/data/cloud/database.ts` is a new, isolated Dexie Cloud Addon database.
  It is not instantiated from the current application shell.
- Cloud primary keys are globally unique strings (`@id`); shared records have
  their own explicit `realmId`. The old numeric D1 `serverId` is not used.
- A new local database name per Telegram account avoids overwriting or mixing
  pre-migration IndexedDB data. Application lifecycle must close the instance
  on account switching when this adapter is activated.

## Server-side Telegram token exchange

`POST /api/dexie-cloud/tokens` accepts the addon `fetchTokens` request.
It validates signed Telegram `x-telegram-init-data` on the Worker and
requests a Dexie Cloud token using the **stable verified** subject
`tg:<telegram_user_id>`. The browser can obtain only `ACCESS_DB` scope;
an untrusted client-supplied `hints.userId` never determines its identity.

Deploy **server-only** Cloudflare Worker secrets:

- `DEXIE_CLOUD_CLIENT_ID`
- `DEXIE_CLOUD_CLIENT_SECRET`

Create a dedicated Dexie Cloud service-account client with
`ACCESS_DB,IMPERSONATE` scopes using the Dexie Cloud CLI, then store its ID
and secret in Cloudflare Secrets (never in GitHub, browser config, or chat).
Do not deploy the database owner's unrestricted key as an application secret
when a scoped service account can be used. If secrets are missing, token
requests fail with HTTP 503; existing D1 routes remain operational.

The original `dexie-cloud.key` contains privileged credentials. It must stay
outside Git, including when working in Codespaces. Both it and other `*.key`
files are ignored by Git.

## Permission model — intended realm setup

A **separate realm per coach-client relationship** is created by the privileged
Worker, not by client-controlled IDs. It must have `owner: null` so the
realm creator does not acquire implicit superuser privileges. Membership is
granted only through verified, idempotent invite acceptance.

`cloud/roles.json` declares two roles:

| Role | Training PLAN (`trainingPlans`) | Workout FACT (`workoutSessions`) | Realms/members |
| --- | --- | --- | --- |
| coach | Read and manage | Read and manage | No direct mutation permission |
| client | Read only | Read and manage | No direct mutation permission |

Both shared record types must explicitly set `owner: null`; otherwise
the Dexie Cloud creator-ownership default can bypass the intended role policy.
These constraints must be preserved as later PLAN child and FACT child tables
are introduced. Other-client data must never appear in a client's local sync.

**Configuration is not auto-applied by Git.** Once the branch is merged and
the database/CLI credentials are available in the original secure Codespace,
import the roles with `npx dexie-cloud import cloud/roles.json`. Verify the
CLI is connected to the database URL above **before** importing. Importing
permissions is a privileged operational step, not a browser operation.

## What is intentionally not enabled in this foundation

- Coach/client role membership and invite redemption in Dexie Cloud.
- Server-confirmed, atomic workout Start or PLAN snapshot creation.
- Mapped domain repositories for exercises, plans, calendar and sessions.
- Replacement/deletion of D1 business APIs, custom SyncEngine or D1 schema.
- React mounting and live sync before cloud roles/permissions are proven.

The new cloud DB class exposes only a small, separate PLAN/FACT pilot schema
and is not used by production screens. Realm creation, membership grants,
record ownership and database permissions must be verified using real
**separate** Coach and Client identities before switching any domain flow.

## Verification matrix for the next activation step

1. Signed Telegram users receive tokens whose `claims.sub` is stable
   across devices, and tampered/expired initData is rejected.
2. Worker creates a relationship realm and grants coach/client membership;
   client A never sees another client's realm or private coach catalogue.
3. Coach can create/update PLAN; client can read it but a direct malicious
   client mutation is **rejected by Dexie Cloud server**.
4. Both participants can edit FACT within their own shared realm; no
   ownership default grants extra PLAN rights.
5. Offline edit, reconnect and secondary device sync work in both roles.
6. Closing or switching Telegram accounts doesn't expose prior user's local data.
7. No unverified multi-request replacement for the existing atomic workout Start.

The added tests check schema/role declarations and token exchange behavior,
including forged client hints and upstream failures. They **do not** prove live
Dexie Cloud server permissions. Those require an authorized integration
environment and independent test users. CI runs on PR creation; no local
npm commands/typecheck/tests are part of this foundation workflow.

References:
- https://dexie.org/docs/cloud/access-control
- https://dexie.org/docs/cloud/db.cloud.configure%28%29
- https://dexie.org/docs/cloud/rest-api
- https://dexie.org/docs/cloud/cli
