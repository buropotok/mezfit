# Workout scheduling foundation (PR 1)

Status: **intent-only infrastructure**. Neither the calendar UI nor any confirmed
booking processor consumes these records yet.

## Domain boundary

- PLAN: `trainingPlans → programPhases → programDays → programExercises → programSets`.
- Booking intent: `workoutScheduleRequests`, an untrusted, **potentially mutable**
  proposal to request a date and time for an existing day. No security-critical
  decision is allowed to rely on its immutability.
- Confirmed booking: `workoutOccurrences`, controlled by trusted lifecycle
  operations. The table already exists, but no normal Coach/Client writer is
  provided by this PR.
- FACT: `workoutSessions` and its immutable snapshot / editable result tables.
  No FACT or workout session is created by requesting a booking.

A program day can be referenced by many requests and later by many occurrences.
PLAN edits never rewrite completed FACT.

## Personal and assigned contexts

A personal program is in its author's personal realm and has no assigned coach.
It can be planned by either a Coach or Client account acting as its owner.
Both roles may request a **self-managed independent** workout there.

Assigned programs are in an approved one-Coach/one-Client relationship realm.
The Coach and Client may request independent workouts. Either may submit a
`coached` request; requests by the Client require a future Coach confirmation
before consuming the Coach's schedule. This future lifecycle is **not**
implemented here. Clients may not request unpublished plans or draft phases;
neither role may schedule deleted or deprecated days.

Every new shared request explicitly supplies `owner: null`. Dexie Cloud Addon
may fill owner with the originating user, granting the creator update/delete
privileges even when the role only permits `add`. **This is expected:** request
records are user-controlled and may change or disappear before processing.
The future privileged Worker must validate the exact latest request payload
and atomically persist an independently authorized canonical occurrence, including
its frozen approved scheduling fields. Once confirmed, further edits/deletion
of the originating intent can never change, undo or re-authorize that booking.
No processor may validate a request, await another asynchronous action, then
implicitly use a potentially changed request row. There is no mutable
`approved` status on these requests.

## Storage and synchronization

Schema v8 defines `workoutScheduleRequests` alongside the unchanged PLAN and
FACT stores, but **production clients open only v7 until the cloud prerequisite is
satisfied**. `MezfitCloudDatabase` registers the v8 store only when the build
flag `VITE_CLOUD_SCHEDULING_SCHEMA_ENABLED` is exactly `true`. An absent or
different value leaves the previous synced table set untouched. It uses a client-supplied canonical primary key `id`, derived
as `req:<verified-cloud-user-id>:<requestKey>`. This names one actor-specific
action consistently on multiple offline devices. The `requestKey` is a
nonunique ordinary index, so different actors can reuse the same key without
making replicated IndexedDB fail. Realm / plan / day lookup indexes and the
compound realm/date index are retained. Two devices using one actor/key to
create conflicting payloads will converge under Dexie Cloud's normal conflict
behavior: **neither the key nor a prior observation represents confirmed
booking state**. Future privileged processing must independently enforce
idempotency by the canonical ID and trusted snapshot.
No D1 identity or custom replication state.

`WorkoutSchedulingRepository` owns local-first writes in an IndexedDB
transaction. `createRequest()` validates date, IANA time zone, DST ambiguity,
source program/day, membership and visibility; the resulting ID is available
immediately. Callers must retain a stable `requestKey` for retries.
`listRequests` and `observeRequests` project the permitted local subset.
`listOccurrences` and `observeOccurrences` are read-only; creation, editing,
deletion, approval and lifecycle transitions are not exposed.

Offline creation is only a **local submission**, never a confirmed booking.
Dexie Cloud Addon owns push/retries; no second syncing engine is introduced.
Initial membership and first hydration still require connectivity.

## Time contract

A schedule request stores local `calendarDate` (YYYY-MM-DD),
`startMinute`, `durationMinutes` and an IANA `timeZone` such as
`Europe/Berlin`. A booking cannot cross the chosen local day's 24:00 boundary.
Nonexistent DST wall-clock times are rejected; ambiguous fall-back times are
also rejected rather than selecting a silent offset. The future UI may
introduce explicit disambiguation.

## Authorization and rollout

Global Coach and Client ACLs grant `add: ['workoutScheduleRequests']`.
No role may `manage` `workoutOccurrences`. Existing Coach PLAN management
and the strictly field-limited FACT updates remain unchanged.

Dexie Cloud table add permission does **not** validate the content of a
user-created row. A future privileged handler must independently verify
Telegram identity, the approved relationship, ownership of the personal
program, the latest plan/day visibility, allowed actor/format, and scheduling
conflicts. It must materialize a canonical occurrence and associate it
idempotently by the request's stable ID, without trusting request fields.
The processor must establish an atomic/serialized reservation mechanism before
promising a clash-free coached booking. It must not fake such a guarantee via
separate uncontrolled REST writes.

`tools/dexie-cloud-relationship.mjs` and
`worker/lib/dexie-cloud-membership.ts` accept exact old and exact new role
shapes during staged rollout, rejecting extra columns/tables.

Deployment order (fail closed for the production client):
1. Merge the code with `VITE_CLOUD_SCHEDULING_SCHEMA_ENABLED` unset. The
   ordinary `.github/workflows/deploy.yml` build automatically deploys but
   stays on **Dexie client schema v7**; the new request table is not registered,
   so old production synchronization cannot fail on the sealed cloud's missing
   table. Do not enable the flag when merging PR 1.
2. Now that the schema target is on `main`, an authorized operator runs the
   protected `dexie-workout-schema.yml` manual workflow with
   `schema_target=scheduling_v1`, confirmation
   `APPLY_SCHEDULING_V1_SCHEMA`. Its reviewed manifest
   `cloud/schema-scheduling-foundation.json` adds only
   `workoutScheduleRequests: id`. The original `workout_v4` target is unchanged.
3. Validate the production schema export, install the reviewed Coach/Client
   roles in the existing approved process, and confirm these permissions
   against the remote role export. **No new user action may run before this.**
4. Only after remote schema and roles are confirmed, set GitHub Actions
   repository variable `VITE_CLOUD_SCHEDULING_SCHEMA_ENABLED=true` and
   manually rerun the protected production deployment. That compiled client
   will then open schema v8. Do not set the flag to any other value.
5. Verify actual Coach/Client isolation and offline request sync with two real
   accounts before enabling any product UI for scheduling. Never represent a
   locally saved intent as a confirmed cloud reservation.
6. Connect the UI, privileged booking processor and calendar in later PRs.
   Retire legacy D1 scheduling only after a complete, verified cutover.

**Safety invariant:** No shipped client registers `workoutScheduleRequests`
before its presence in the remote Dexie Cloud schema is confirmed. The
source-level `CLOUD_DATABASE_VERSION=8` denotes the *available* next
version; the active production version remains 7 until the explicit feature
flag is enabled. Changing the flag prematurely violates this prerequisite.

This PR intentionally leaves `TodayPage` and the old D1 endpoints untouched.
