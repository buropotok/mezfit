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

Schema v8 adds `workoutScheduleRequests` alongside unchanged PLAN and
FACT stores. `MezfitCloudDatabase` registers v8 unconditionally; there is no
compatibility mode, schema version toggle or fallback to v7. It uses a client-supplied canonical primary key `id`, derived
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
`listOccurrences`, `observeOccurrences` and `getOccurrence` require an explicit
view: `program` shows an athlete's active planned workouts to the authorized
coach and client; `calendar` shows workouts occupying the actor's own
calendar. In an assigned program, `independent` workouts belong to the
**client's** calendar, regardless of who scheduled them. Only approved
`coached` occurrences occupy the **coach's** calendar. A coach's *personal*
independent workout occupies their own calendar. Cancelled occurrences never
appear in either active projection, including `getOccurrence`. Cancellation
history needs a separate history read model, not a calendar workaround.
All these reads are read-only; creation, editing, deletion, approval and
lifecycle transitions are not exposed.

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
`worker/lib/dexie-cloud-membership.ts` require the **current exact** Coach
and Client role policies. Earlier Coach PLAN-only grants and roles without
`workoutScheduleRequests` permissions are rejected. No staged old/new role
compatibility is supported.

Development environment setup (no backwards compatibility):
1. Merge the reviewed code; client schema v8 is enabled unconditionally.
2. Run the protected `dexie-workout-schema.yml` workflow on `main`, choosing
   `schema_target=scheduling_v1` with confirmation
   `APPLY_SCHEDULING_V1_SCHEMA`. The reviewed manifest
   `cloud/schema-scheduling-foundation.json` adds
   `workoutScheduleRequests: id` only.
3. Install the **exact** current Coach and Client roles from
   `cloud/roles.json`; confirm the schema and ACL against the cloud exports.
4. Verify Client/Coach isolation and local-first synchronization in the
   development environment before exposing the scheduling UI.

Because this is a nonproduction development environment, **temporary
synchronization failure between code deploy and cloud schema/role setup is
acceptable**. Do not claim the scheduling feature works until the cloud
schema and ACL have been installed. There is no v7 fallback or guarantee that
a device running outdated schema/role definitions remains functional.

UI activation, server-confirmed reservations and calendar integration are
later tasks, not compatibility paths in this PR.

This PR intentionally leaves `TodayPage` and the old D1 endpoints untouched.
