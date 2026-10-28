# Client workout execution foundation

Status: repository and protected ACL preparation. Client UI is not switched in
this slice; no cloud import or ordinary-account server validation is claimed.

## Scope and ownership

`ClientWorkoutRepository` explicitly selects the athlete execution context of the
existing `AdHocWorkoutRepository`. It reuses the synchronized `adHocSessions`,
`adHocExercises`, `adHocSets` graph, projection, transaction boundaries, validators,
PLAN protection and Addon replication. No new tables or schema version are needed.
The existing Coach-context repository and Client read-only screen keep their
current behavior until the next UI slice deliberately adopts this repository.

The Client context supports:

- personal quick Start, without source-program creation or modification;
- Start from the athlete's own published, accessible occurrence;
- idempotent reopening of an existing active occurrence link;
- reactive detail/open-session reads, including active Coach-created sessions
  for that athlete;
- FACT recording, FACT-only exercise/set additions and tombstones, comments,
  ordering within the existing frozen-PLAN restrictions, and completion;
- completion of the linked occurrence in the same local transaction.

The Client cannot use the Coach `createForAthlete` program/template workflow.
`resolveTemplate` still requires the creator and existing source-program
permissions; Client Start never creates an automatic program/template. When the
Client completes an older Coach-created auto-program session, its pending
save-template decision remains for the Coach who owns that source program.

Start takes the accepted local occurrence PLAN, never rebuilds it from a cloud
program, and copies its full execution graph in one transaction. Client Start
updates only `status`, `workoutSessionId`, `updatedAt` on the occurrence; it does
not republish or overwrite `plan`, `originalPlan`, or `publishedPlan`. Draft,
foreign, revoked, cancelled, inactive and personal-event records cannot start.
Duplicate local Start intents serialize; reopening reuses the link. This does not
promise global single-Start serialization across disconnected devices.

An active Coach session for the athlete is also the Client's active execution,
so it blocks a competing personal Start. The Coach and Client continue subsequent
sets/exercises on the same graph. Handoff remains a sequential product convention,
without a privileged ownership transfer, per-session locks, or custom merge.
Rare same-field conflicts use standard Dexie Cloud behavior. FACT changes touch
one set, never replace a stale whole-workout snapshot. Previous/history integration
and mobile UI entry points belong to later slices.

## Authorization and exact cloud delta

Every relationship execution row retains `realmId` and `owner: realmId` as the
non-user sentinel; personal rows retain actor ownership. Identity, parent keys,
occurrence provenance and the frozen `occurrencePlan` cannot be updated by the
new role grants. Source program PLAN remains Coach-controlled. Publication is a
local business-visibility rule, independently of eager Addon replication.

`cloud/client-session-roles.json` is an overlay, not a standalone full-role import.
It adds to Client only:

| Operation | Exact scope |
| --- | --- |
| add | `adHocSessions`, `adHocExercises`, `adHocSets` |
| update session | `name`, `comment`, `status`, `completedAt`, `templateSaveDecision`, `updatedAt` |
| update exercise | `position`, `deletedAt`, `notes` |
| update set | `position`, `deletedAt`, `setType`, `actualReps`, `actualWeightKg`, `actualDurationSeconds`, `actualDistanceMeters`, `setLabel`, `rpe`, `comment`, `bands`, `setStatus` |
| update occurrence | append `status`, `workoutSessionId` to the prior fields |

No DELETE/manage grant, identity update, source-program grant, old scheduled FACT
change, schema change, membership change, new credential or business-data write
is part of the operator. Ordinary shared Client mutations require the locally
replicated complete execution grants; missing activation rejects before any
write. That guard is not server authorization and does not wait for cloud push.
Personal owner writes do not depend on relationship role activation.

The new protected operator `tools/dexie-roles/client-sessions.mjs` accepts only the
complete frozen calendar-cancellation baseline or its exact completed target.
It imports only the full replacement Client role; Coach and all unrelated roles
and metadata must remain unchanged. Membership preflight recognizes the complete
new profile in addition to prior supported profiles, rejecting partial grants.
Older operators remain frozen and are not used to roll back the new profile.

`.github/workflows/dexie-client-sessions.yml` reuses the existing protected
`dexie-production` environment secret and writer concurrency. It is owner/main
manual dispatch only. Preview is read-only; apply requires the literal
`APPLY_CLIENT_SESSION_ACL`, a fresh full schema/roles recheck, exact payload
validation and full readback, including failed import or no-op apply. Temporary
credentials and exports remain private and are cleaned. No PR/push trigger runs
this operation. As with prior operators, export/recheck/import is not a remote
CAS: administrators must exclude competing out-of-band configuration changes.

## Rollout and verification

1. Review this delta and its new repository, operator and membership tests; PR CI
   runs install, tests, typecheck and build. Existing tests are not rewritten to
   make the new slice pass. No local npm/test/typecheck/build execution is claimed.
2. After review/merge, preview the exact live baseline through the protected
   workflow. Apply only as a separately authorized operation, retaining full
   readback evidence. Configuration readback does not prove per-user permissions.
3. With real ordinary Client A, verify allowed shared graph insertion and FACT
   edits, Coach visibility, offline Start/completion, reconnect and reopen. Verify
   immutable identity/snapshot updates, source PLAN writes and DELETE are denied.
   Verify Client B, unrelated users and revoked members cannot read or write A's
   realm even with guessed IDs; repeat denied tests through direct cloud calls.
4. Verify Client writes do not change numeric PLAN or old Coach FACT in subsequent
   sets; test Coach-to-Client sequential continuation and linked completion.
5. The next UI slice adopts the Client repository for the workout screen, calendar
   and FAB as one source of active-session state. Only then retire the legacy
   REST fallback; no runtime activation is implied by this foundation PR.
