# Mezfit Local-First Storage and Synchronization Architecture

**Status:** Accepted architectural direction  
**Scope:** Telegram Mini App frontend, local persistence, integration layer, synchronization with Cloudflare Worker/D1  
**Goal:** remove network latency from normal user interactions and establish a portable data architecture for future Android/iOS applications.

## 1. Core decision

Mezfit uses a local-first data flow.

React UI does not directly use REST as its normal persistence path and does not depend on the physical storage implementation.

```text
React UI
    ↓
Application / Domain Repository API
    ↓
Local Storage
    ↓
Sync Engine
    ↓
Remote Sync Gateway
    ↓
HTTP API
    ↓
Cloudflare Worker
    ↓
D1
```

For the Telegram Mini App, the physical local database is IndexedDB behind a replaceable adapter, initially expected to use Dexie.

```text
Repository API
    ↓
LocalStore
    ↓
IndexedDB adapter
    ↓
Dexie / IndexedDB
```

Product components, hooks and domain repositories must not import Dexie or IndexedDB directly.

A future native application can replace only the physical adapter:

```text
Telegram Mini App → IndexedDB adapter
Android / iOS     → SQLite adapter
```

The repository contracts, sync engine, snapshot contracts and most React/domain code should remain unchanged.

## 2. Role of local storage and D1

D1 remains authoritative durable server storage and the server trust boundary.

The local database is the device working copy and may temporarily contain newer user state than the last synchronized server state.

Normal mutation flow:

```text
UI action
   ↓
local transaction
   ├── mutate domain data
   └── mark sync scope dirty
   ↓
UI immediately observes the new local state

independently:

Sync Engine
   ↓
snapshot
   ↓
server
```

Network latency must not be on the critical path of ordinary user data entry.

UI reads normal working data from local storage.

## 3. Integration layer

The existing `src/api.ts` remains the remote HTTP transport layer.

Product components must migrate away from directly calling persistence-oriented REST functions. The integration boundary becomes:

```text
React component
      ↓
Domain Repository
      ↓
LocalStore
```

Remote synchronization is separate:

```text
SyncEngine
    ↓
RemoteSyncGateway
    ↓
src/api.ts / sync HTTP API
```

A component may call:

```ts
workoutRepository.saveSet(sessionId, setId, fact)
```

It must not call Dexie/IndexedDB directly and, after migration of that surface, must not call the old REST mutation directly.

Recommended ownership:

```text
src/data/
  repositories/
  local/
    indexedDb/
  sync/
  remote/
  react/
```

Exact file names may evolve, but these architectural boundaries must remain explicit.

## 4. Local data shape

The local database stores normalized domain entities rather than one opaque JSON document.

Expected logical stores include the existing domain graph, for example:

```text
users
coach_clients

exercise_definitions
exercise_definition_overrides
exercise_favourites

training_plans
program_phases
program_days
program_exercises
program_sets

workout_occurrences

workout_sessions
session_exercises
session_sets

settings

sync_scopes
sync_remote_state
```

The synchronization payload may be a larger JSON snapshot. Snapshot transport format must not dictate the physical local database schema.

```text
normalized local DB
        ↓
SnapshotBuilder
        ↓
JSON snapshot
        ↓
server
```

## 5. Stable identity

Entities that can be created locally before server synchronization need a stable client-generated synchronization identity, normally UUID-based.

Existing D1 integer IDs may remain server-internal identities.

Conceptually:

```text
id       // D1/internal server id where applicable
sync_id  // stable cross-device identity
```

This is required so local graphs can be created without temporary numeric IDs that later need relationship rewrites.

The exact list of entities receiving `sync_id` is defined as each domain is migrated.

## 6. Synchronization scopes

Synchronization is snapshot-based, not a replay of every CRUD event.

### Dynamic scope

The primary dynamic scope is:

```text
client + calendar day
```

Canonical conceptual key:

```text
client-day:{clientId}:{YYYY-MM-DD}
```

In Client Mode, `clientId` is the current client.

In Coach Mode, the selected client is explicit. A coach does not push all data for all clients when one client's day changes.

The day scope contains the current synchronized state belonging to that client/day, including relevant workout occurrences and workout execution state.

### Static scopes

A program and all of its children are a separate static scope:

```text
program:{programId}
```

The program graph includes:

```text
training_plan
program_phases
program_days
program_exercises
program_sets
```

A program is not a calendar entity. Its date attributes do not make it part of a day scope.

Settings are also a separate static scope.

Exercise data is a first-class replicated domain, not a disposable request cache. The local exercise catalogue must be sufficient to open exercise selection, search, filters and categories without a network request.

Conceptual exercise scopes:

```text
exercise-global
exercise-coach:{coachId}
exercise-client:{clientId}
```

The global catalogue is primarily server-owned replicated reference data. Coach/client custom exercises, user-specific overrides and favourites belong to the appropriate owner scope and synchronize as mutable domain state.

Coach/client relationships and the coach's client directory are also locally replicated so the client list can open immediately. Relationship mutation remains server-coordinated control plane, but its resulting state is replicated down to local storage.

## 7. Local replica breadth versus mutation scope

The amount of data retained locally is intentionally broader than an individual synchronization mutation scope.

```text
local working dataset = broad
mutation/snapshot scope = narrow
```

In Coach Mode the local database should retain the domain data needed for the coach's complete working set of active clients, including historical workout execution required for Previous/Plan/Fact, progress, charts and cross-period analytics. Weeks or months of history must be queryable locally without waiting for REST.

At minimum this includes the coach's client directory, programs, relevant exercise catalogue state, workout occurrences, workout sessions, session exercises and session sets for linked clients.

Client list and calendar are immediate-read surfaces. After the initial hydration has occurred, opening either surface must render from IndexedDB first and must not wait for a network round trip.

Analytics and chart queries are computed from local persisted history. Server-side aggregation may exist for other purposes, but ordinary coach analytics must not require a synchronous server request.

Media blobs are not part of this domain replica. Store media metadata/reference URLs in the local domain database and treat actual image/video caching as a separate concern.

If a coach/client relationship is revoked or becomes inaccessible, the server must emit an authorization/revocation change and the client must purge locally retained private data that is no longer authorized.

## 9. Dirty scopes instead of CRUD event replay

UI mutations may generate an internal dirty signal/event, but synchronization does not need to preserve and replay every intermediate field mutation.

The persistent sync state is scope-oriented.

Conceptual `sync_scopes` data:

```text
scope_key
scope_type

local_revision
last_synced_revision

status

attempt_count
next_retry_at
last_error

inflight_revision
inflight_request_id

server_revision
```

Each local domain mutation must atomically:

```text
BEGIN
mutate local domain data
increment scope local_revision
mark scope dirty
COMMIT
```

If a user changes a value several times before synchronization, only the latest authoritative scope snapshot needs to reach the server.

## 9. Ordering and inflight synchronization

A dirty scope has an ordered local revision.

When Sync Engine sends revision N, it must remember which revision/request is inflight.

If the HTTP result is ambiguous because a VPN/network connection drops after the server may have applied the request, the same logical request must be retryable idempotently.

After acknowledgement:

- if current local revision still equals the acknowledged revision, the scope can become clean;
- if local revision advanced while the request was in flight, the acknowledged revision is recorded but the scope remains dirty and the newer snapshot is sent next.

This prevents older state from overwriting newer state while still allowing intermediate local changes to collapse into a current snapshot.

## 10. Retry and manual synchronization

Retry is owned by Sync Engine.

Expected states include:

```text
clean
dirty
syncing
retry_wait
blocked
conflict
```

Temporary failures such as offline, timeout, 429 and retryable 5xx responses use bounded exponential backoff with jitter.

After automatic retry limits are exhausted, local user data remains intact.

The user can explicitly request synchronization.

A manual "Синхронизировать" action must wake/requeue Sync Engine. It must not create a second direct REST mutation path.

## 11. Server sync API

The worker sends/receives scope snapshots rather than interpreting a client-side event log.

Conceptually:

```text
PUT /api/sync/client-days/:clientId/:date
GET /api/sync/client-days/:clientId/:date

PUT /api/sync/programs/:programSyncId
GET /api/sync/programs/:programSyncId

GET /api/sync/changes?after={cursor}
```

Exact routes are implementation details and may differ.

The server applies snapshots to the existing relational D1 domain model. Snapshot JSON does not replace the relational server model.

Every committed server-side mutation that can affect another authorized device/user must also append a durable change-feed record in the same logical commit/transaction as the domain mutation.

Conceptual change record:

```text
change_id            // monotonic cursor/sequence
recipient_user_id
scope_key
scope_type
scope_revision
change_kind          // changed | deleted | revoked
created_at
```

The change feed contains invalidation/version metadata, not necessarily the full domain snapshot. The client uses it to decide which scope snapshot must be pulled.

Server-side validation and authorization remain mandatory.

## 12. Authorization and trust

Local storage is never proof of identity, role, ownership or authorization.

The Cloudflare Worker remains the trust boundary and must derive the authenticated actor from trusted authentication, then validate domain authorization before applying synchronization data.

Local changes to IDs or ownership fields cannot grant permissions.

## 13. WorkoutSession FACT ownership

Workout execution is the only domain area where write ownership may move between users over the lifetime of a session.

There is still only one writer at a time.

Conceptually, a session distinguishes:

```text
client/user whose workout this is
user who started/created execution
current FACT editor/owner
```

A coach may own FACT entry during an in-person workout and later explicitly transfer edit ownership to the client (or another authorized user).

"Shared" FACT means sequential ownership across the session lifetime, not concurrent writes by multiple users.

The current owner is the only actor authorized to push new FACT mutations.

## 14. Ownership transfer is control plane

WorkoutSession edit-ownership transfer is not an ordinary offline snapshot mutation.

It changes write authority and requires server coordination.

Therefore ownership transfer is a synchronous/server-confirmed control-plane operation.

After confirmation, local state is reconciled through synchronization.

The old owner must no longer be allowed to push new FACT changes created after ownership has moved.

## 15. Data plane versus control plane

Most domain data uses the local-first data plane:

```text
UI → Local DB → asynchronous Sync Engine → server
```

Operations that change authentication, authorization relationships or exclusive write authority remain server-coordinated control-plane operations.

Examples include:

```text
authentication
coach/client relationship changes
WorkoutSession FACT ownership transfer
future operations that change exclusive write authority
```

## 16. React behavior

React must render from local domain state.

A successful local transaction is a successful local user operation.

Network synchronization state is separate from domain mutation success.

For example, saving a set while offline must update the workout immediately and may expose a separate sync indicator, but must not present the set entry itself as failed merely because the server is temporarily unreachable.

Dexie live queries or an equivalent mechanism may be used inside the integration layer, but product components must not depend on Dexie-specific APIs.

## 17. Startup, hydration and immediate-read surfaces

When local data exists:

```text
open app
↓
render local state immediately
↓
background catch-up / hydration
```

Client list, calendar and exercise catalogue are immediate-read surfaces. After initial hydration they must open from local storage without waiting for REST.

On a first installation or an empty per-user local database:

```text
authenticate
↓
bootstrap minimum shell/client-directory data
↓
render as soon as locally persisted data is available
↓
continue full hydration in background
```

Coach Mode deliberately hydrates and retains the working history of all currently linked clients, not only the selected client. Full hydration must be progressive and must never block an already-usable UI.

Recommended priority:

```text
1. identity + client directory
2. visible calendar window + current/active workout state
3. exercise catalogue
4. current programs
5. remaining historical client-day scopes
```

After the first successful hydration, normal launches render from IndexedDB first and use background synchronization only to catch up changes.

The local database is account-scoped. Switching authenticated Telegram users must not expose another account's local replica.

## 18. Remote change detection, catch-up and Telegram WebView lifecycle

The architecture must not assume JavaScript keeps running after Telegram closes/suspends the Mini App.

Reliable server-to-client synchronization uses a durable **change feed + cursor**. Push delivery is an acceleration mechanism only; it is never the sole source of correctness.

Each local account stores a remote cursor in `sync_remote_state`.

Catch-up flow:

```text
local cursor = N
↓
GET /api/sync/changes?after=N
↓
receive changed scope keys/revisions
↓
pull and transactionally apply required snapshots
↓
advance local cursor only after successful local application
```

A duplicate change or repeated pull is safe because scope revision/idempotency rules prevent regression.

If a cursor is older than the retained change-feed window, the server returns a reset/full-resync requirement. The client rehydrates the authorized replica rather than guessing which changes were missed.

### Push acceleration

While the Mini App is active, an optional realtime channel may notify it that remote changes exist. The preferred future transport is a WebSocket endpoint, potentially backed by Cloudflare Durable Objects.

A push message is only an invalidation/wake-up hint, for example:

```text
remote changes available
latest change id = 18492
```

The client does not trust/apply domain state directly from the WebSocket message. It runs the normal cursor catch-up flow.

Therefore WebSocket disconnects, duplicated messages, VPN failures, Telegram suspension and process death cannot lose domain changes.

On WebSocket connect/reconnect the client always performs cursor catch-up. A low-frequency cursor poll may remain active as a health fallback even while WebSocket is connected.

For the first implementation, correctness may use cursor polling without WebSocket. Adding WebSocket later improves freshness without changing synchronization semantics.

### Sync triggers

```text
local mutation
application startup
Telegram activated / foreground-resume
online/network recovery
remote push hint
periodic cursor poll while active
manual sync
periodic retry while the app is alive
```

Dirty local state and the remote cursor persist in IndexedDB. On the next activation/start, the app resumes both outbound synchronization and inbound catch-up.

A Telegram/bot notification to the human user may be added for product notifications, but it is not a data replication mechanism and cannot be required for local database correctness.

## 19. Worker implementation

"Sync worker" is a logical responsibility.

The first implementation may be an in-app async service. It does not have to be a browser Web Worker.

IndexedDB and HTTP are already asynchronous.

A Dedicated Web Worker may be introduced later if profiling demonstrates a need. Service Worker background execution is not a required foundation of Mezfit synchronization.

## 20. Migration strategy

The migration is incremental by domain surface, not a single rewrite.

First establish:

```text
Repository contracts
LocalStore
IndexedDB adapter
SyncEngine
sync metadata
RemoteSyncGateway
```

Then migrate a complete vertical slice.

The first preferred slice is WorkoutSession / FACT because it has the highest latency sensitivity and exercises the important synchronization guarantees.

Then migrate:

```text
client + day / calendar
program static scopes
settings
remaining persistent surfaces
```

Once a domain surface is migrated, it must not have two competing mutation paths. Remove the obsolete direct REST mutation path for that surface.

## 21. Native portability

Storage is accessed behind platform-independent interfaces.

Telegram:

```text
Repository
   ↓
LocalStore
   ↓
IndexedDbLocalStore
```

Future native application:

```text
Repository
   ↓
LocalStore
   ↓
SQLiteLocalStore
```

User data moves between platforms through server synchronization:

```text
IndexedDB
   ↓ sync
D1
   ↓ sync
SQLite
```

Direct export of Telegram IndexedDB into the native application is not required.

## 22. Architectural invariant

After migration, ordinary Mezfit persistence follows:

```text
UI → local domain storage
```

and synchronization follows independently:

```text
local domain storage ↔ Sync Engine ↔ server
```

REST is not part of the critical path for ordinary user data entry.

Server-coordinated control-plane operations are the deliberate exception.
