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
sync_groups
sync_dependencies
sync_remote_state
authorization_leases
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

## 6. Synchronization scopes, transport batches and read models

Synchronization remains snapshot-based: Mezfit does not replay every field-level CRUD event. However, three different concepts must not be conflated:

```text
consistency scope
  = independently versioned/CAS-protected state

transport / hydration batch
  = several scopes moved in one HTTP request for efficiency

local read model
  = projection/aggregation used by UI and analytics
```

A day or date range is an excellent **transport/hydration batch**, but it is not automatically a safe consistency scope.

### Scope invariants

Every mutable consistency scope must satisfy all of the following:

1. Any actor allowed to write the scope is authorized to read the complete mutable state needed to reconcile that scope.
2. The scope has exactly one server revision sequence.
3. The scope does not mix data with different write-authority lifecycles.
4. The scope key is based on stable identity/ownership, not a mutable placement attribute such as calendar date.
5. Moving an entity between dates/collections must not require deleting one consistency scope and creating another if the entity itself is the atomic business object.
6. Aggregated read models are never pushed back as one mutable snapshot.

### Domain scope map

| Domain | Consistency scope | Writer / authority | Notes |
| --- | --- | --- | --- |
| Coach/client relationship | `relationship:{coachId}:{clientId}` | server-coordinated control plane | Drives authorization/leases and revocation |
| Scheduled occurrence | `occurrence:{occurrenceSyncId}` | actor allowed by occurrence edit rules | Date/time are fields of the occurrence; cross-day reschedule remains one scope |
| Workout execution | `workout-session:{sessionSyncId}` | current FACT owner | Contains frozen PLAN + exercises + sets + FACT; separate from calendar |
| Program graph | `program:{programSyncId}` | program owner | Contains plan/phases/days/exercises/sets |
| Program ordering | `program-index:{ownerActorId}:{subjectUserId}` | program collection owner | Ordered list of program IDs; avoids multi-program CAS for reorder |
| Global exercises | `exercise-global` | server-owned | Replicated reference scope |
| Coach exercise catalogue state | `exercise-coach:{coachId}` | coach | Coach definitions, overrides/favourites as appropriate |
| Pair/client exercise state | `exercise-client:{coachId}:{clientId}` | authorized pair owner | Existing domain ownership includes both IDs |
| User settings | `user-settings:{userId}` | user | Only for user-scoped settings that exist in the domain |

The current global `app_setting` configuration is server configuration/reference data and must not be confused with future user-scoped settings.

### Calendar read model

Calendar is an aggregated local read model over occurrence scopes:

```text
client calendar for date D
  =
  occurrence scopes visible to that client where calendarDate = D

coach calendar for date D
  =
  occurrence scopes visible to that coach where calendarDate = D
```

A client with multiple coaches therefore sees all authorized occurrences without forcing those coaches to share a revision.

A cross-day reschedule updates the `calendarDate` field of one `occurrence:{id}` scope. It does not perform a source-day delete plus destination-day insert at the synchronization layer.

### Day/range batching is still encouraged

The network may still hydrate or upload by client/date range to keep request counts low:

```text
GET hydration(clientId, fromDate, toDate)
  → occurrence snapshots + workout-session snapshots + revisions

POST sync/batch
  → several independently versioned scope snapshots
```

Each contained scope retains its own `baseServerRevision`, result and conflict state. One transport envelope must never create an implicit shared revision.

### Static and catalogue scopes

A program remains independent of calendar placement. Its dates are program metadata; placing an occurrence on a calendar does not move the program into a day scope.

The exercise catalogue is a first-class replicated domain, not a disposable request cache. Exercise selection, search, filters and categories must be satisfiable from local storage.

A client catalogue may aggregate global, coach and pair-owned exercise scopes for display. That aggregate is read-only from the synchronization perspective.

Coach/client relationships and the coach's client directory are locally replicated so the client list can open immediately. Relationship mutation itself remains server-coordinated control plane.

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

IndexedDB indexes/read projections must support the hot analytical paths without scanning the whole replica. At minimum implementation design should support indexed lookup by client, workout date/range, exercise definition and session status. Rebuildable local materialized projections (for example exercise progress points) are allowed for performance; they are derived caches, not synchronization scopes, and must be reproducible from normalized local domain data.

Media blobs are not part of this domain replica. Store media metadata/reference URLs in the local domain database and treat actual image/video caching as a separate concern.

If a coach/client relationship is revoked or becomes inaccessible, the server must emit an authorization/revocation change and the client must purge locally retained private data that is no longer authorized.

## 8. Dirty scopes, atomic local writes and dependencies

The persistent synchronization state is scope-oriented.

Conceptual `sync_scopes` data:

```text
scope_key
scope_type

local_revision
last_synced_local_revision

applied_server_revision
pending_remote_revision

dirty_base_server_revision
dirty_base_snapshot

status

attempt_count
next_retry_at
last_error

inflight_revision
inflight_request_id
inflight_base_server_revision
inflight_payload
```

When a clean scope becomes dirty for the first time, the client preserves the clean base snapshot/revision. JSON snapshots are small enough that keeping this temporary base for dirty scopes is acceptable and gives deterministic three-way reconciliation:

```text
base
local
remote
```

Each local domain mutation must atomically:

```text
BEGIN
mutate normalized domain data
increment affected scope.local_revision
preserve dirty base if transition clean → dirty
mark scope dirty
write dependency/group metadata when required
COMMIT
```

If the Mini App is killed immediately after commit, both the user data and the information needed to synchronize it survive together.

### Cross-scope references

Stable `sync_id` values allow local entities to reference objects that have not reached D1 yet. The worker must still respect dependencies.

Examples:

- a newly created custom exercise immediately added to a program;
- a newly created custom exercise immediately added to an active workout session;
- a locally created program referenced by another locally created object.

A dependent scope must not be pushed before the referenced entity is remotely addressable, unless both changes are part of one supported atomic server operation.

`sync_dependencies` stores these unresolved scope dependencies. The Sync Engine processes them topologically and returns `blocked` rather than creating dangling remote references.

## 9. Ordering, CAS, reconciliation and cross-scope atomicity

A local revision and a server revision are separate counters.

For a single-scope write, Sync Engine freezes:

```text
requestId
scopeKey
localRevision
baseServerRevision
snapshot
```

The server applies compare-and-swap:

```text
accept only when currentServerRevision == baseServerRevision
```

On success the server increments the scope revision and returns it. On mismatch it returns a domain conflict such as `409 SCOPE_STALE` and applies nothing. Last-write-wins is never an implicit fallback.

For a newly created scope, the write uses explicit create semantics (`baseServerRevision = null` / create-if-absent). The server accepts it only if that stable scope identity has never been created/tombstoned for a conflicting object, then returns the first revision. A deleted scope is never silently recreated with the same stable ID; a genuinely new business entity receives a new `sync_id`.

A local hard-delete intent, where the domain permits hard deletion, is represented as a dirty tombstone carrying the last applied server revision. The server CAS-applies the tombstone and emits `deleted`. Domains that use archive/deprecate/cancel states continue to synchronize those states as ordinary active-scope snapshots instead.

If the HTTP response is lost after the server may have committed, the client retries the exact frozen request with the same `requestId`. Server idempotency is keyed by authenticated actor + request ID and must return the original semantic result.

After acknowledgement:

- the returned server revision becomes `applied_server_revision`;
- if no newer local mutation exists, the scope becomes clean and its dirty base is released;
- if the local revision advanced, the scope remains dirty and the next snapshot is based on the acknowledged server revision.

### Remote change while local state is dirty

Inbound synchronization never overwrites dirty/inflight state.

When a newer remote revision exists:

- clean scope → pull and transactionally apply it;
- dirty/inflight scope → persist `pending_remote_revision` and fetch/retain the remote snapshot for reconciliation without replacing local working state.

Reconciliation is three-way:

```text
dirty_base_snapshot
current_local_snapshot
current_remote_snapshot
```

A domain reconciler may auto-rebase only when it can prove the local and remote mutations do not overlap semantically. Otherwise the scope becomes `conflict`. Both sides are retained; manual retry must not bypass the conflict with a forced overwrite.

Typical conflicts are the same actor editing the same occurrence/program/session from two devices.

### Design away unnecessary multi-scope writes

Scope boundaries should eliminate most atomicity problems:

- moving an occurrence to another date is one `occurrence` scope;
- editing sets/reordering exercises is one `workout-session` scope;
- editing a program graph is one `program` scope;
- reordering programs is one `program-index` scope.

### Truly cross-scope business operations

If a business operation must atomically change multiple independent scopes, it must use either:

1. a server-coordinated control-plane command, or
2. one `sync_group` committed all-or-nothing with CAS preconditions for every affected scope.

A `sync_group` freezes:

```text
groupRequestId
[
  { scopeKey, baseServerRevision, localRevision, frozenPayload }
]
```

The server checks every precondition first. If any scope is stale/unauthorized, nothing in the group is applied. On success all writes, revision increments and change-feed records commit atomically.

No implementation may approximate an atomic move by sending two independent scope writes.

### Lifecycle side effects

Some lifecycle operations have a primary scope plus a deterministic server-side side effect.

Examples:

- Start workout: server-confirmed control plane creates/materializes the session and atomically moves the linked occurrence to `in_progress`.
- Completing a linked workout session: the accepted `workout-session` lifecycle transition may atomically move its linked occurrence to `completed`; the server increments/emits the occurrence scope revision as a side effect.
- FACT ownership transfer: server-confirmed control plane updates the workout-session owner/ownership epoch.

The client may optimistically reflect these derived occurrence statuses locally, but it must not create a second independent dirty day snapshot for the same server-derived lifecycle transition.

## 10. Retry, backpressure and manual synchronization

Retry/backpressure is owned by Sync Engine.

Expected states include:

```text
clean
dirty
syncing
retry_wait
blocked
conflict
```

Error classes are explicit:

```text
offline / timeout / retryable 5xx
  → exponential backoff + jitter

429
  → respect server retry timing, then retry

401 / authentication expired
  → pause remote work and re-establish authenticated session

authorization revoked / OWNER_CHANGED
  → apply authorization/ownership lifecycle handling; do not retry as transport failure

409 SCOPE_STALE
  → reconcile or conflict; do not blind-retry same stale snapshot

deleted / gone lifecycle
  → tombstone handling

400 / 422 invalid domain payload
  → blocked; repeated transport retries are useless
```

### Backpressure

The worker must not create a request storm after VPN/network recovery.

Rules:

- at most one inflight write per consistency scope;
- a scope cannot overtake its own earlier frozen inflight state;
- independent scopes may synchronize concurrently with a small bounded concurrency limit;
- dirty scopes are coalesced to the newest safe snapshot before transmission;
- blocked/conflicted scope A does not freeze unrelated scope B;
- dependencies prevent dependent scopes from overtaking prerequisites;
- transport batching may combine independent ready scopes without merging their CAS results.

Suggested priority is product-aware:

```text
active workout / FACT
visible calendar/current client
ownership/control reconciliation
program/catalog edits
background history hydration
```

The exact concurrency number is an implementation/configuration detail.

After automatic retry limits are exhausted, local user data remains intact.

A manual "Синхронизировать" action wakes/requeues the same Sync Engine. It does not create a second REST mutation path and never bypasses authorization, ownership, dependency or conflict checks.

## 11. Server sync API, scope state and durable change feed

Exact routes are implementation details, but the conceptual API separates scope snapshots, hydration batches and change-feed catch-up.

```text
GET  /api/sync/bootstrap
GET  /api/sync/changes?after={cursor}
GET  /api/sync/hydrate?clientId=...&from=...&to=...
GET  /api/sync/scopes/:scopeKey       // canonical single-scope snapshot/lifecycle pull

PUT  /api/sync/occurrences/:syncId
PUT  /api/sync/workout-sessions/:syncId
PUT  /api/sync/programs/:syncId
PUT  /api/sync/program-index/...
PUT  /api/sync/exercise-scopes/...

POST /api/sync/batch
POST /api/sync/groups
```

The server applies snapshots to the existing relational D1 domain model. Snapshot JSON does not replace the relational server model.

### Server synchronization metadata

The backend needs durable synchronization metadata conceptually equivalent to:

```text
sync_scope_state
  scope_key
  scope_type
  revision
  lifecycle_state        // active | deleted
  schema_version

sync_idempotency
  actor_user_id
  request_id
  semantic_result

sync_change
  change_id
  recipient_user_id
  scope_key
  scope_type
  scope_revision
  change_kind            // changed | deleted | revoked
  target_identity
  created_at
```

Domain mutation, scope revision update and change-feed append must be one logical atomic commit.

### Recipient-specific change feed

The feed is addressed to `recipient_user_id`, not authorized dynamically by the current scope relationship. This is essential for revocation: a user must still be able to receive the minimal `revoked` purge instruction after permission to read the underlying scope has already been removed.

A revocation record contains purge identity/metadata only, never the now-private domain payload.

### Effective change pages

`GET /changes?after=N` returns a bounded effective page:

```json
{
  "throughCursor": 18492,
  "changes": []
}
```

Within the covered interval the server may coalesce repeated invalidations for the same scope to the latest effective revision/lifecycle state. A later `deleted` or `revoked` event supersedes earlier `changed` invalidations for that same scope.

The client may advance to `throughCursor` only after every effective change in the page is durably represented locally.

This prevents a sequence such as:

```text
K     changed
K + 1 revoked
```

from deadlocking on an obsolete snapshot pull for K.

### Snapshot pull lifecycle contract

The generic single-scope pull (conceptually `GET /api/sync/scopes/:scopeKey`) is the canonical follow-up for a change-feed invalidation. Domain-specific read routes may delegate to the same contract.

A pull for a known scope/change must normalize to one of:

```text
snapshot(revision, payload)
deleted(terminalRevision, targetIdentity)
revoked(targetIdentity / purgeIdentity)
```

A generic 404/403 is not enough for synchronization state machines.

If a scope was deleted/revoked after the change page was produced but before the snapshot GET, the snapshot endpoint returns the terminal lifecycle result. The client applies tombstone/purge and can continue catch-up; a later duplicate destructive feed record is idempotent.

### Deletion and revocation

- `deleted`: remove/tombstone the object from normal read models. If local unsynchronized edits exist, preserve them only as a blocked `remote_deleted` conflict payload; do not silently resurrect the object.
- `revoked`: authorization loss wins. Purge locally retained data that this recipient no longer has an entitlement to retain, including dirty/inflight copies and conflict payloads for that entitlement.
- Shared/reference data is removed only when no other active entitlement still authorizes it.
- The cursor advances past destructive state only after the local tombstone/purge transaction commits.

### Conditional writes

Every snapshot write carries `requestId`, `scopeKey`, `schemaVersion` and `baseServerRevision`. Unsupported schema versions are rejected explicitly; clients must never interpret schema mismatch as an ordinary conflict.

## 12. Authorization, authorization leases and cached private data

Local storage is never proof of identity, role, relationship, ownership or authorization.

The Cloudflare Worker is the trust boundary and derives the authenticated actor from trusted Telegram authentication before any sync read/write.

### Authorization manifest / lease

To combine instant cached reads with revocation safety, relationship-protected local data is guarded by a server-issued authorization manifest/lease.

Conceptually:

```text
authorization_leases
  entitlement_key
  relationship_id
  subject ids
  authorization_epoch
  valid_until
```

Bootstrap/authentication returns the current manifest together with the initial change-feed boundary.

Rules:

- while a relationship entitlement lease is valid, cached authorized data may render immediately and work offline;
- on online startup/foreground the app refreshes/catches up authorization in the background while valid leases permit immediate render;
- if a protected entitlement lease has expired, relationship-protected data must not be rendered or mutated until authorization is refreshed;
- if the device is offline with an expired lease, self-owned data and public/global reference data may remain available, but expired relationship-private data is gated;
- a `revoked` feed event invalidates the lease immediately and triggers purge.

A still-valid offline lease permits local work but is not a promise that a later server write will be accepted if authorization changed while the device was disconnected. When catch-up reveals revocation, server authorization wins; no manual retry may resurrect the relationship. Product UX may surface that unsynchronized work could not be submitted.

This is a deliberate bounded-offline-access model. Immediate revocation while a device is completely offline is impossible without also forbidding all offline cached access; the lease defines that security/product boundary explicitly rather than leaving it accidental.

### Recipient-specific purge

Revocation purge is based on the recipient's entitlements, not a blanket deletion of every record mentioning the other user.

Examples:

- a coach who loses a client relationship purges that client's private replica and pair-owned scopes;
- a client who loses a coach relationship purges coach-owned program/catalog data no longer authorized, but does not lose the client's own workout FACT/history merely because the coaching relationship ended;
- retained client-owned history must not be left with dangling references: minimal reference/display metadata required to render retained FACT must either remain independently authorized or be materialized into the retained session/history projection;
- globally shared exercise definitions remain;
- data reachable through another still-valid entitlement remains.

The local model must therefore retain enough ownership/entitlement metadata to compute purge safely.

## 13. WorkoutSession scope and FACT ownership

Workout execution has its own consistency scope:

```text
workout-session:{sessionSyncId}
```

It is not embedded in a mutable day/calendar scope.

The scope contains the session-owned frozen PLAN, session exercises, session sets and FACT needed to execute/review that workout. Calendar and analytics join this session locally through stable IDs/date fields.

Workout FACT may be entered by different users over the lifetime of one session, but there is exactly one FACT writer at any instant.

Conceptually a session distinguishes:

```text
client/user whose workout this is
started_by_user_id
fact_owner_user_id
ownership_epoch
```

A coach may own FACT entry during an in-person workout and explicitly transfer it later to the client or another authorized user.

All FACT snapshot writes carry the ownership epoch implicitly/explicitly as part of server authorization. If ownership changed while an old owner was offline, the stale owner write is rejected as `OWNER_CHANGED`; it is never merged automatically into the new owner's state.

Program edits after Start do not affect the session scope because PLAN was frozen/materialized at Start.

Adding an ad-hoc exercise or editing/reordering sets stays inside the workout-session scope. If the session references a newly created custom exercise not yet synchronized, the exercise dependency must be acknowledged first or included in a supported atomic group.

### Timeout completion and offline FACT

Server timeout completion must not discard legitimate FACT recorded locally while the device was offline.

A timeout-only remote transition is a domain-reconcilable lifecycle change when the local dirty state was produced under the same ownership epoch. The session reconciler may apply the local FACT over the timeout transition and recompute canonical completion metadata from the latest accepted workout activity. An explicit ownership change/revocation is different and cannot be auto-rebased.

### Historical correction

Completed-session corrections continue to obey the same single-writer/ownership-epoch rule. If another authorized user must correct FACT, ownership/correction authority is transferred or granted explicitly by the server; completion does not create a free multi-writer state.

## 14. Ownership transfer is control plane

WorkoutSession FACT ownership transfer changes write authority and is never an ordinary offline snapshot edit.

The operation is synchronous/server-confirmed.

Before ownership changes, the current owner's device must not leave unsynchronized FACT behind. Transfer therefore requires either a clean workout-session scope or an atomic transfer request that includes the current owner's latest frozen session snapshot and its `baseServerRevision`.

The server atomically:

```text
validate current owner/relationship/ownership epoch
CAS-apply included pending FACT snapshot when present
increment ownership epoch
set new fact owner
increment workout-session server revision
append recipient change-feed records
```

If pending FACT cannot be committed, ownership does not transfer.

After confirmation both users reconcile through the normal feed.

The old owner immediately loses permission to push new FACT. Offline edits discovered after transfer are retained only as a local blocked diagnostic/conflict until the product decides how to present them; they cannot be force-synchronized by manual retry.

The new owner must not enable FACT editing until its local workout-session scope reflects the confirmed new `ownership_epoch`.

## 15. Data plane versus control plane

Most ordinary domain editing uses the local-first data plane:

```text
UI → Local DB → asynchronous Sync Engine → server
```

Control-plane operations are those that establish identity, authorization, exclusive ownership, or require a fresh authoritative snapshot before execution.

Current/future examples:

```text
authentication
coach/client invite/accept/deactivate/reactivate
WorkoutSession initialization/Start when fresh PLAN must be materialized
WorkoutSession FACT ownership transfer
other operations that change exclusive write authority
```

A control-plane operation may still update local storage immediately after server confirmation so all subsequent UI reads continue to come from the local database.

Cross-scope atomic operations that do not change authority may remain asynchronous through `sync_group`; they do not automatically become control plane.

## 16. React behavior

React must render from local domain state.

A successful local transaction is a successful local user operation.

Network synchronization state is separate from domain mutation success.

For example, saving a set while offline must update the workout immediately and may expose a separate sync indicator, but must not present the set entry itself as failed merely because the server is temporarily unreachable.

Dexie live queries or an equivalent mechanism may be used inside the integration layer, but product components must not depend on Dexie-specific APIs.

## 17. Startup, hydration, authorization gating and immediate-read surfaces

Client list, calendar and exercise catalogue are immediate-read surfaces **when their cached entitlements are valid**.

### Normal launch with valid leases

```text
open app
↓
open account-scoped IndexedDB
↓
validate cached authorization lease timestamps
↓
render authorized local state immediately
↓
background auth/feed catch-up + outbound sync
```

### Expired protected lease

If relationship-protected cached data has no valid lease:

```text
open app
↓
do not render/mutate expired relationship-private scopes
↓
refresh authorization/bootstrap
↓
purge revoked entitlements
↓
unlock still-authorized local scopes
```

Self-owned/public/reference data can still render locally.

### First installation / empty local database

Bootstrap must establish both authorization and a change-feed boundary before baseline hydration.

One bootstrap response should provide a consistent minimum envelope:

```text
authenticated user
authorization manifest / lease set
bootstrapStartCursor = N
schema/version metadata
```

Then:

```text
persist manifest + N
↓
hydrate authorized baseline scopes progressively
↓
run change-feed catch-up after N
↓
declare replica current only after catch-up
```

The implementation must never hydrate first and then set the cursor to the current feed head.

A mutation committed after N is either already present in a later hydration response or replayed by catch-up. Duplicate application is prevented by scope revisions.

If a scope vanishes during hydration, its lifecycle response/feed event resolves it through normal deletion/revocation semantics.

### Hydration priority

Coach Mode intentionally retains the working history of all currently authorized clients, but hydration is progressive:

```text
1. identity + authorization manifest + client directory
2. visible calendar range + active/current sessions
3. exercise catalogue
4. current programs/program indexes
5. remaining historical occurrence/session scopes
```

History hydration never blocks an already-authorized UI surface that has local data.

The local database is account-scoped. Switching authenticated Telegram users never exposes another user's replica.

## 18. Remote change detection, catch-up, reset and Telegram lifecycle

The architecture must not assume JavaScript keeps running after Telegram suspends/closes the Mini App.

Correctness uses durable change feed + cursor. Push/WebSocket is an acceleration mechanism only.

Each local account stores `sync_remote_state`.

### Catch-up

```text
local cursor = N
↓
GET effective changes after N
↓
for each effective change:
  changed + clean scope
      → pull lifecycle result
      → apply snapshot OR terminal tombstone/purge
  changed + dirty/inflight scope
      → persist pending remote revision + remote snapshot/lifecycle
  deleted
      → tombstone / remote_deleted conflict
  revoked
      → entitlement-aware purge
↓
commit throughCursor only when all effective changes are durable locally
```

A dirty scope never blocks the global cursor merely because it cannot yet be merged: the pending remote state is durably recorded first.

### Change disappears before pull

If a `changed` invalidation races with deletion/revocation, the snapshot pull returns a terminal lifecycle result. The client does not loop forever on 404/403 waiting for a later feed record.

### Feed retention exceeded / RESET_REQUIRED

A full resync must not destroy unsynchronized local work.

Required strategy:

```text
freeze dirty/inflight local snapshots + dependencies
↓
obtain fresh authorization manifest + bootstrap cursor
↓
build a new baseline in a shadow local generation
↓
purge pending work no longer authorized
↓
rebase still-authorized dirty scopes against new baseline
   or mark conflict
↓
atomically switch active local generation
↓
catch up after bootstrap cursor
```

Never clear/recreate IndexedDB in place while dirty scopes exist.

The same rule applies to local schema migrations: migration failure must not silently drop unsynchronized data. A destructive local reset is allowed only when no unsynced state exists or after it has been durably preserved.

### Push acceleration

While active, an optional WebSocket channel may send only a wake-up hint such as:

```text
remote changes available
latest change id = 18492
```

The client always performs normal cursor catch-up. WebSocket disconnects, duplicate hints, VPN failures and process death therefore cannot lose state.

On connect/reconnect and Telegram foreground/activation, run catch-up. A low-frequency cursor poll remains a valid fallback.

### Sync triggers

```text
local mutation
application startup
Telegram activated / foreground
online/network recovery
authorization lease refresh
remote push hint
periodic cursor poll while active
manual sync
retry timer while app is alive
```

Human-facing Telegram notifications may be added separately but are never a replication mechanism.

## 19. Sync Engine execution and multi-instance safety

"Sync worker" is a logical responsibility. The first implementation may run as an in-app async service; it does not require a browser Web Worker.

IndexedDB and HTTP are asynchronous and do not block rendering when used correctly.

### One network synchronizer per local account

Multiple browser/WebView instances can theoretically open the same origin/account database. Local repository writes remain transactional, but only one instance should actively drain outbound sync/catch-up at a time.

Use a renewable per-account synchronization lease/leader lock (Web Locks when available, otherwise an IndexedDB lease with expiry/owner instance ID).

If leader failover races and two requests are sent anyway, server idempotency/CAS still guarantees correctness.

A Dedicated Web Worker may be introduced later if profiling justifies it. Service Worker background execution is not required for correctness.

### Storage durability and quota

Because Coach Mode retains historical data for many clients, the local storage layer must monitor quota and request persistent browser storage when the environment supports it.

Eviction policy is strict:

```text
never evict:
  dirty
  inflight
  conflict
  dependency metadata

may evict under pressure:
  clean historical scopes that are fully rehydratable
  rebuildable analytics projections
  media/browser caches
```

Evicting clean historical data changes hydration completeness, not synchronization correctness. UI must know whether a requested historical range is locally complete before presenting analytics as complete.

## 20. Migration strategy

Migration is incremental by coherent ownership surface, not by individual REST function.

First establish the infrastructure:

```text
Repository contracts
LocalStore / IndexedDB schema
stable sync IDs
sync scope metadata + dirty bases
dependencies / optional sync groups
authorization manifest / leases
bootstrap + durable change cursor
SyncEngine + leader lease
RemoteSyncGateway
```

Then migrate complete vertical slices:

```text
1. identity/authorization/client-directory bootstrap
2. exercise catalogue replica
3. occurrence scopes + calendar local read model + create/reschedule/cancel
4. workout-session scope + FACT editing + lifecycle reconciliation
5. program scopes + program-index ordering
6. user settings and remaining persistent surfaces
7. analytics/projections built exclusively from local history
```

Read ownership and mutation ownership move together. Once a product surface renders a migrated entity from IndexedDB, its ordinary mutations must update the same local authoritative model immediately; a competing REST-only mutation path must not remain.

Transport batching by client/day/range may be introduced at any stage, but batching must never merge independent revisions into one shared consistency scope.

Once a domain surface is migrated, obsolete direct REST mutation paths for that surface are removed.

## 21. Required scenario behavior

The architecture is not considered implemented correctly unless these scenarios have deterministic behavior:

| Scenario | Required behavior |
| --- | --- |
| Client has two coaches editing schedules | Independent occurrence scopes/revisions; aggregated calendar only |
| Occurrence moves to another day | One occurrence CAS updates its date; no source/destination day split write |
| Same occurrence edited on two devices | Second stale write receives conflict; base/local/remote are retained |
| Different occurrences edited concurrently | No conflict merely because they share a day |
| Coach edits program while client has active workout | Program syncs independently; active session keeps frozen PLAN |
| New custom exercise is immediately used in program/session | Dependency ordering or supported atomic group prevents dangling reference |
| App closes immediately after local edit | Domain change + dirty metadata survive in one IndexedDB transaction |
| HTTP response is lost after commit | Same request ID retries idempotently and returns original result |
| Workout starts from scheduled occurrence | Server-confirmed Start atomically freezes PLAN, creates/activates session and marks occurrence in-progress |
| FACT ownership transfers coach → client | Ownership epoch changes atomically; old-owner pushes are rejected |
| Session completes | Session transition is accepted once; linked occurrence completes atomically/server-side and emits its own invalidation |
| Scope changes then is deleted before pull | Effective feed/lifecycle pull resolves to terminal delete; cursor cannot deadlock |
| Relationship revoked while app sleeps | Expired/invalid lease prevents protected cached render; revoke purges recipient-specific unauthorized data |
| WebSocket message is missed | Cursor catch-up still receives every durable change |
| Change feed cursor expired | Shadow-generation resync preserves/rebases authorized dirty local work |
| Two Mini App instances run | One sync leader; duplicate network work is harmless through CAS/idempotency |
| Manual Sync pressed after retry exhaustion | Retries transport failures only; never bypasses auth/conflict/ownership checks |
| Local schema upgrade fails | Unsynchronized data is preserved; destructive reset is forbidden while dirty state exists |
| FACT ownership transfers while current owner has dirty sets | Pending session snapshot commits atomically with transfer or transfer fails |
| Server timeout completes session while device has offline FACT | Same-ownership FACT is reconciled; timeout must not erase valid local results |
| IndexedDB quota pressure occurs | Dirty/inflight data is never evicted; only clean rehydratable/derived data may be dropped |
| Historical analytics range is partially evicted/not yet hydrated | UI knows completeness and hydrates missing clean scopes before claiming complete analytics |

These are architecture-level acceptance cases. Implementation PRs should add automated tests for the subset they introduce.

## 22. Native portability

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

## 23. Architectural invariant

After migration, ordinary Mezfit persistence follows:

```text
UI → local domain storage
```

and synchronization follows independently:

```text
local domain storage ↔ Sync Engine ↔ server
```

REST is not part of the critical path for ordinary user data entry.

The final separation is:

```text
UI/read model       → local normalized DB
consistency         → independently versioned ownership scopes
network efficiency  → client/day/range transport batches
remote freshness    → durable recipient change feed + cursor
authorization       → server truth + bounded local leases
```

Transport batching must never redefine ownership or consistency boundaries.

Server-coordinated control-plane operations are the deliberate exception to local-first mutation flow.
