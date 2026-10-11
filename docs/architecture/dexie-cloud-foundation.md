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

`cloud/roles.json` declares narrow, server-enforced permissions. Dexie Cloud
grants visibility (read/sync) through membership in the relationship realm.
Mutation permissions below are **additional** to that visibility. The table
applies specifically to the **Worker-created coach-client relationship realm**,
not to a user's own private realm:

| Table | Coach | Client | Owner/creation rule |
| --- | --- | --- | --- |
| `trainingPlans` (coach-authored PLAN) | `manage` | Read only | `owner: null`; coach manages plan content |
| `workoutSessions` (session identity, schedule & status) | Read only | Read only | Privileged Worker creates/transitions |
| `sessionSets` (immutable planned set snapshot) | Read only | Read only | Privileged Worker materializes snapshot |
| `sessionSetFacts` (measurements per snapshot set) | Update explicit FACT fields only | Update same fields only | Privileged Worker creates one row per snapshot set |
| `realms`, `members`, `roles` | No direct role grants | No direct role grants | Privileged Worker/administrator only |

Allowed updates to `sessionSetFacts` are exactly:
`actualReps`, `actualWeightKg`, `actualDurationSeconds`,
`actualDistanceMeters`, `setLabel`, `rpe`, `comment`, `bands`,
`setStatus` (status of a **set result**, not the session lifecycle).

No role has `manage` on workout sessions or FACT records, nor `add` for
creating new FACT rows. This prevents an ordinary client — or coach acting
through the ordinary synced UI — from deleting facts, impersonating a record
owner, switching its realm, replacing its session ID, changing PLAN snapshot
values, or mutating workout lifecycle status directly. These actions are
handled by a narrowly authorized Worker operation when product behavior
requires them.

Each `sessionSetFacts` record has a **distinct, deterministic** ID
(`fact:<sessionSetId>`) and a foreign key `sessionSetId` referencing its
immutable `sessionSets` row. The FACT table deliberately declares a regular
`id` primary key instead of `@id`: Dexie Cloud's `@id` enforces a
table-specific ID prefix and does not allow reuse of `sessionSets` IDs.
This deterministic key preserves one-to-one creation and idempotency across
devices without assuming cloud-enforced uniqueness of secondary indexes.
The linked rows' `realmId` and `workoutSessionId` must match.
Each immutable `sessionSets` snapshot also carries its parent `sessionExerciseId`;
the corresponding `sessionExercises` snapshot table must be introduced by
the workout-domain migration before this pilot schema is activated.
The privileged Start operation is responsible for atomically creating
the session, consistent PLAN snapshot, and initial FACT rows. Creation of
additional exercises or sets during an active workout requires a separate,
authorized operation; it is **not** implicitly granted to all clients by
allowing arbitrary `add` into the FACT table. Editing existing FACT rows
works offline through the addon once the data has synchronized.

### Sequential FACT handoff (MVP)

The shared FACT permissions support a simple real-life workflow: the coach
records the sets/exercises already performed together, and the client
continues with **subsequent** sets/exercises. Alternating edits to one
set are not a normal MVP scenario. Dexie Cloud handles ordinary offline
synchronization; no custom per-set editor locks, ownership-transfer API,
immutable edit history, or server-verified last-editor ledger is required.

Technical persistence timestamps and optional diagnostics must not be used
to authorize edits. The cloud role and relationship realm membership are
the authoritative access-control boundary. A future full audit trail would
require a separate business decision, not an assumption derived from both
participants having FACT permissions.

All shared rows are created with explicit `owner: null`: otherwise Dexie
Cloud's default ownership can give a creator full permissions regardless of
role. The privileged Worker must also create relationship realms with
`owner: null` and separately grant coach/client membership. Membership
alone must not grant rights beyond the declared roles. **Never grant an
untrusted client ownership of the relationship realm**, since the realm
owner has implicit full rights over every table in that realm.

Dexie Cloud still permits a user to create and control **their own unrelated
realms**. Lack of a role grant here does not disable Dexie Cloud's built-in
personal ownership permissions. The app and the Worker must never treat a
client-supplied realm ID, self-created realm, or self-assigned role as proof
of an existing coach-client relationship. Only the Worker-maintained
relationship registry and membership of its non-owned realm is trusted.

Later PLAN child tables (phases/days/exercises/sets), occurrence controls,
and session exercise snapshots require the **same explicit allowlist
review** before they are introduced; avoid broad wildcard permissions.
A client has no PLAN editing controls in UI, but only server-side
permissions are a security boundary.

**Configuration is not auto-applied by Git.** Once the branch is merged and
the database/CLI credentials are available in the original secure Codespace,
import the roles with `npx dexie-cloud import cloud/roles.json`. Verify the
CLI is connected to the database URL above **before** importing. Importing
permissions is a privileged operational step, not a browser operation.
Because import is additive, export the resulting roles (`npx dexie-cloud export --roles`)
and confirm neither role retains earlier broad permissions on
`workoutSessions`, `sessionSets`, or `sessionSetFacts` before granting
membership. Do not enable the new domain repositories until this check
and the real two-account authorization tests succeed.

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
   across devices; tampered/expired initData and forged identity hints are rejected.
2. Worker creates a **non-owned** relationship realm and grants just
   coach/client roles. A client cannot read another client's realm or private
   coach catalogue by changing an ID.
3. Coach can author and change assigned PLAN within the approved relationship
   realm. Client can read it, but direct sync attempts to add/update/delete
   **the assigned PLAN in that realm** are rejected by Dexie Cloud server.
   Self-created personal realms must not be mistaken for assigned programs.
4. Both coach and client can update permitted FACT metrics on an existing
   `sessionSetFacts` record. Direct attempts to add/delete facts, move them
   between sessions or realms, or change `owner`, `id`, or other protected
   fields are rejected by Dexie Cloud server.
5. Direct attempts by **either role** to create/change/delete
   `workoutSessions` or `sessionSets`, including `status`,
   `trainingPlanId`, start/completion timestamps and frozen PLAN snapshots,
   are rejected by Dexie Cloud server; the authorized Worker retains
   server-confirmed lifecycle transitions.
6. Neither coach nor client can change the **Worker-created relationship
   realm**, its members or role assignments through ordinary sync. Dexie
   Cloud may let them create separate realms that the application must not
   interpret as approved relationships. No relationship realm owner override
   may grant hidden privileges.
7. FACT edits work offline and synchronize on reconnect from either member;
   unrelated set fields are not overwritten by stale whole-session snapshots.
8. Closing or switching Telegram accounts doesn't expose prior user's local data.
9. No unverified multi-request replacement for the existing atomic Workout Start
   is enabled. Privileged creation is idempotent (including FACT/PLAN linkage).
10. Separate `sessionSets` and `sessionSetFacts` keys are accepted by the
    real Dexie Cloud schema, and one-to-one FACT materialization is idempotent.

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
- https://dexie.org/docs/cloud/best-practices
