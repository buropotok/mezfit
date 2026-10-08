# Mezfit Local-First Storage and Synchronization Architecture

**Status:** MVP architecture  
**Scope:** Telegram Mini App local storage, frontend integration layer, and synchronization with Cloudflare Worker/D1  
**Goal:** make normal product interaction independent of REST/VPN latency while keeping D1 as durable server storage.

## 1. Core model

Mezfit is local-first.

Normal UI work goes through the local database:

    React UI
       ↓
    Repository / application service
       ↓
    IndexedDB

Server synchronization is separate:

    IndexedDB
       ↓
    Sync Engine
       ↓
    HTTP API
       ↓
    Cloudflare Worker
       ↓
    D1

The UI must not wait for REST for ordinary reads and ordinary editable data entry.

D1 remains durable server storage and the server trust boundary.

For the Telegram Mini App, local persistence is IndexedDB through a replaceable adapter. Dexie is the preferred initial implementation.

Product components must not import Dexie or IndexedDB directly.

This boundary also keeps future native ports simple:

    Telegram Mini App → IndexedDB adapter
    Android / iOS     → SQLite adapter

Repository contracts and most React/domain code remain unchanged.

## 2. Integration layer

The existing src/api.ts remains the remote HTTP transport layer.

Product components migrate from:

    React component → src/api.ts → REST

to:

    React component
          ↓
    Repository / application service
          ↓
    LocalStore

The Sync Engine is the normal path from locally edited domain data to the server.

Recommended structure:

    src/data/
      repositories/
      local/
        indexedDb/
      sync/
      remote/

Exact file names may evolve, but the architectural rule is fixed:

> React works with domain repositories, not with REST, Dexie, or IndexedDB directly.

## 3. Local database

The local database is a normalized working copy of the Mezfit domain, not a temporary screen cache.

Expected stores include:

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

    sync_scopes
    sync_remote_state

The exact IndexedDB schema is defined during implementation, but it must preserve the existing domain relationships.

### What must be local

Client Mode keeps the client's working domain data locally.

Coach Mode keeps the working data for all of the coach's clients locally, including historical workout execution required for Previous/Plan/Fact, charts and analytics.

The following surfaces must open from IndexedDB without waiting for REST after initial hydration:

- client list;
- calendar;
- exercise catalogue;
- programs already hydrated locally;
- workout/session history;
- analytics based on hydrated history.

Exercise selection must never require reloading the catalogue from the server on each open.

Media files are a separate cache concern. IndexedDB stores exercise metadata/reference URLs, not a required permanent copy of all images/video.

## 4. Stable IDs

Objects that can be created locally before the server sees them need a stable client-generated ID, normally UUID.

Conceptually:

    sync_id    // stable identity across local DB, D1 and future native clients
    server_id  // existing D1 integer ID where still useful

Local relationships should use stable IDs so creating data offline does not require temporary numeric IDs followed by graph rewrites.

## 5. Synchronization model

Synchronization sends current snapshots, not a replay of every UI action.

The MVP does not need a generic event-sourcing system and does not need a universal merge engine.

Each independently editable domain area has a synchronization scope. Examples:

    occurrence:{occurrenceSyncId}
    workout-session:{sessionSyncId}
    program:{programSyncId}
    exercise-coach:{coachId}
    exercise-client:{coachId}:{clientId}

A scope stores minimal synchronization metadata:

    scope_key
    scope_type

    local_revision
    server_revision

    status              // clean | dirty | syncing | retry_wait | conflict
    attempt_count
    next_retry_at
    last_error

    inflight_request_id
    inflight_revision

A local mutation is one IndexedDB transaction:

    BEGIN

    change domain data
    increment local_revision
    mark scope dirty

    COMMIT

The UI sees the result immediately.

### Snapshot write

The Sync Engine sends the current scope snapshot with:

    requestId
    scopeKey
    baseServerRevision
    snapshot

The server accepts the snapshot only if the current server revision still matches baseServerRevision, then increments it.

If the HTTP response is lost, the same request can be retried with the same requestId so the server can return the same result instead of applying the change twice.

If the server revision no longer matches, the scope becomes conflict.

For MVP there is no generic automatic three-way merge. The conflicting scope is reconciled explicitly.

Because Mezfit deliberately separates write ownership, these conflicts should be exceptional rather than normal operation.

### Network batching

Day/client/date-range payloads may still be used to reduce HTTP request count during hydration or synchronization.

Batching is only transport optimization. It does not change ownership or turn all data for a day into one shared revision.

## 6. Retry and manual synchronization

Temporary network failures do not make the local user action fail.

For offline, timeout, VPN failure, retryable 5xx or 429:

    keep local data
    ↓
    keep scope dirty
    ↓
    retry with backoff

A failed scope does not block unrelated scopes.

If automatic retries are exhausted, the data remains local.

The user action Синхронизировать simply wakes the same Sync Engine and retries eligible dirty scopes. It does not create a second direct REST mutation path and does not bypass authorization or a real conflict.

Only one request for the same scope is sent at a time.

The MVP does not require browser leader election, Web Locks, cross-tab fencing, or a Service Worker.

## 7. Receiving changes made on the server

This is the mechanism that lets a client learn that a trainer changed a program.

The reliable mechanism is a durable server change feed + cursor.

Whenever a server-side change affects data that another user/device should refresh, the Worker records an invalidation:

    change_id
    recipient_user_id
    scope_key
    scope_revision
    created_at

The local database stores:

    remote_cursor

Catch-up:

    remote_cursor = N
    ↓
    GET /api/sync/changes?after=N
    ↓
    receive changed scope keys
    ↓
    pull the current snapshot for those scopes
    ↓
    write snapshots into IndexedDB
    ↓
    advance remote_cursor

Example:

    trainer edits program
    ↓
    program saved in D1
    ↓
    change_feed records program:{id} for the client
    ↓
    client polls after its cursor
    ↓
    client sees program:{id} changed
    ↓
    fresh program snapshot is loaded in background
    ↓
    IndexedDB updates
    ↓
    React updates from local DB

### When catch-up runs

At minimum:

- application startup;
- Telegram foreground/activation;
- network recovery;
- periodic polling while the Mini App is open;
- after successful relevant server control operations.

### Push/WebSocket

WebSocket may be added later as an optimization.

Its job is only to say:

    remote changes are available

After that the client performs the same cursor catch-up.

Therefore correctness does not depend on WebSocket delivery. If Telegram is closed, VPN drops, or a push signal is missed, the next cursor catch-up still finds the program change.

For MVP, polling + cursor is sufficient.

### Initial hydration

On a new or empty local database:

    authenticate
    ↓
    obtain bootstrap cursor N
    ↓
    hydrate required local data
    ↓
    run change-feed catch-up after N
    ↓
    continue normal operation

This prevents losing a server change that happens while the initial local copy is being populated.

Hydration is progressive and must not block already available local UI.

Recommended order for Coach Mode:

    1. identity + client list
    2. visible calendar/current workout state
    3. exercise catalogue
    4. current programs
    5. remaining client history

## 8. Domain-specific exceptions

Most product mutations are local-first.

A few operations intentionally remain server-confirmed because they establish an authoritative execution boundary.

### Workout Start

Current workout Start remains server-confirmed because Start fresh-reads the selected PLAN, materializes the session snapshot and changes the persisted workout lifecycle.

After the response, the resulting session is written to IndexedDB and all further normal FACT editing reads/writes locally.

### WorkoutSession FACT ownership transfer

FACT has one writer at a time.

A workout may start under the trainer and later be handed to the client, but editing is never parallel.

Transfer flow:

    temporarily stop FACT editing on the old owner
    ↓
    sync the latest workout-session snapshot
    ↓
    server confirms ownership transfer
    ↓
    update the local session ownership
    ↓
    new owner may edit after receiving the updated session

If the latest FACT cannot be synchronized, ownership transfer does not complete.

No universal shared-write merge is needed.

### Calendar lifecycle display

Do not create a second independent optimistic write only to mirror workout lifecycle in workout_occurrence.

For local UI, effective in_progress/completed state can be derived from the linked local workout_session while the server-side occurrence status catches up through the accepted lifecycle operation/synchronization.

## 9. Local analytics and performance

Coach analytics must be computed from local persisted history.

The local schema/indexes should support the main access patterns:

    client
    date/date range
    exercise
    workout session

If analytics later becomes expensive, rebuildable local projections may be added. They are caches derived from normalized local domain data, not new synchronization sources of truth.

The first product goal is straightforward:

> weeks and months of client history should be browsable and chartable without synchronous REST calls.

## 10. Migration plan

Do not rewrite the entire application in one PR.

First create the infrastructure:

    IndexedDB/Dexie adapter
    Repository contracts
    sync_scopes
    Sync Engine
    RemoteSyncGateway
    change-feed cursor

Then migrate coherent product surfaces:

    1. client directory + initial hydration
    2. exercise catalogue
    3. calendar / workout occurrences
    4. WorkoutSession / FACT
    5. programs
    6. remaining persistent data and analytics

When a surface is migrated, its UI reads from IndexedDB and its normal mutations write to IndexedDB. The old direct REST mutation path for that surface is then removed.

Implementation PRs should test the synchronization behavior they introduce, but this architecture does not require solving unrelated distributed-systems scenarios in advance.

## 11. Architectural invariant

Normal Mezfit behavior:

    UI → local DB

Background replication:

    local DB ↔ Sync Engine ↔ D1

Incoming server changes:

    D1 change → change feed → cursor catch-up → local DB → UI

The network is replication infrastructure, not part of the normal UI critical path.

Server-confirmed control operations are deliberate, small exceptions.
