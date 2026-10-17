# Workout scheduling foundation (PR 1)

Status: **intent-only infrastructure**. Neither the calendar UI nor any confirmed
booking processor consumes these records yet.

## Domain boundary

- PLAN: `trainingPlans → programPhases → programDays → programExercises → programSets`.
- Booking intent: `workoutScheduleRequests`, an untrusted, immutable-by-policy
  instruction to request a date and time for an existing day.
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
may fill owner with the originating user. That does not confer business
authority: the request remains untrusted regardless of owner. In particular
the original requester's claims, participants and timing are **not** proof of
an accepted booking. There is no mutable `approved` status on these requests.

## Storage and synchronization

Schema v8 adds `workoutScheduleRequests` alongside the unchanged PLAN and
FACT stores. It has an Addon-generated `@id`, an independent unique
`requestKey` for local retry deduplication, realm / plan / day lookup indexes,
and a compound realm/date index. Dexie Cloud does not enforce secondary
index uniqueness across devices; future privileged processing must enforce
idempotency using the canonical globally unique request ID, not assume
`requestKey` is globally unique. No D1 identity or custom replication state.

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

Deployment order:
1. Deploy schema v8 and the Worker/admin policy compatibility checks.
2. Publish the new request table to the existing Dexie Cloud database.
3. Update installed global roles using the existing authorized process.
4. Verify actual Coach/Client isolation and offline request sync with two
   real identities. No automatic role push from a browser.
5. Only in later PRs connect the UI, verified processor and calendar.
6. Retire legacy D1 scheduling reads/writes only when the Dexie calendar has
   fully replaced them. Do not operate a parallel authoritative schedule.

This PR intentionally leaves `TodayPage` and the old D1 endpoints untouched.
