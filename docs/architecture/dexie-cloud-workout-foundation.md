# Workout Dexie Cloud foundation (schema v4)

Status: **schema / typed read boundary only; no workout write cutover**.

## Existing foundations

`trainingPlans`, `workoutSessions`, `sessionSets` (immutable PLAN) and
`sessionSetFacts` (editable measurements on existing PLAN sets) are already
declared in v1. The existing Coach/Client role policy in `cloud/roles.json`
is unchanged. The assigned-program header rollout is still independently gated
by `VITE_CLOUD_ASSIGNED_PROGRAMS_ENABLED`.

## Added v4 tables

- PLAN authoring, coach-owned relationship realm: `programPhases` →
  `programDays` → `programExercises` → `programSets`.
- `workoutOccurrences`: schedule intent, separate from execution.
- `sessionExercises`: the immutable exercise snapshot created at privileged
  Workout Start; `sessionSets` remains the immutable set snapshot.
- `sessionFactExercises` and `sessionFactSets`: exercises and sets inserted
  **during execution**, separate from the frozen PLAN. Only their FACT may
  eventually be edited by Coach/Client. This separation avoids granting client
  add/manage on the PLAN snapshot tables.
- Existing `sessionSetFacts`: one-to-one with privileged PLAN session sets.
  Their identity/foreign keys cannot be changed by regular roles.

Each shared row has its **own** `realmId` and `owner:null`. IDs are stable
strings, generated via the `@id` cloud policy for these new tables. Program and
session children must have a valid parent in the **same relationship realm**.
For coach-private exercise references, a stable exercise metadata snapshot
must be readable by the client without exposing the coach's private catalogue.

The new `WorkoutFoundationRepository` is read-only, validates the canonical
Worker-provisioned two-member relationship and only projects rows with matching
realm/parent references. It does not implement a mutation or become a second
authority; screens remain on their current owners until vertical cutover.

## Permission model — not yet activated

| Table group | Coach | Client | Write gate |
| --- | --- | --- | --- |
| programPhases / programDays / programExercises / programSets | Author PLAN only | Read PLAN | Block until installed server coach-only ACL verified |
| workoutOccurrences | Schedule privileges based on creator and status | Scheduled own-event edits only | Needs privileged validation of status and actor |
| workoutSessions / sessionExercises / sessionSets | Read immutable Start snapshot | Read immutable Start snapshot | Worker-only privileged lifecycle |
| sessionSetFacts | Update approved FACT measurements | Update approved FACT measurements | Existing field allowlist; verify live |
| sessionFactExercises / sessionFactSets | Append and edit permitted FACT | Append and edit permitted FACT | **No grants yet**; must validate parent/session, provenance and scope |

Do **not** grant `manage` over immutable PLAN snapshot tables to either
relationship role. Do **not** simply grant broad `add` to FACT-only tables
without verifying server-side parent realm, activity state and exercise
identity: an arbitrary client-supplied FK cannot authorize a write. A
narrow privileged operation may be required for creation; ordinary field-scoped
FACT updates should stay local-first.

The currently committed `cloud/roles.json` still only permits Coach
`manage:trainingPlans` and both roles to update the nine FACT fields in
`sessionSetFacts`. New tables are denied by default, not made writable by
this schema-only PR. The installed remote roles **must** be exported and
compared to the intended policy before any rollout.

## Deployment order — blocking prerequisite for merge/deploy

Adding v4 stores changes the auto-opened account database schema. A sealed
Dexie Cloud server must have the new table declarations installed **before**
a client built with v4 can sync successfully:

1. In the privileged Dexie Cloud CLI environment, export the existing remote
   schema and roles to private, protected files; confirm the intended DB URL.
2. Review that the new eight table names are unused and the remote primary
   keys are compatible with `@id`. Import
   `cloud/schema-workout-foundation.json` with `npx dexie-cloud import`.
3. Export `--schema` again and verify all eight new tables. **Do not import
   a permissive roles file**, and do not touch historical table keys.
4. Only then merge/deploy the client with `CLOUD_DATABASE_VERSION = 4`.
   The production deploy pipeline does not apply Dexie Cloud schema/roles.
5. Verify initial sync and offline reads with separate Coach A, Client B and
   Client C. Ensure B cannot read C's realm and Client cannot mutate PLAN via
   direct Dexie Cloud sync. Verify ownerless row behavior and the actual
   installed `roles`, not just code or mocked unit tests.

The repository does **not** contain privileged credentials; schema import and
live ACL checks must be performed by an authorized operator. Tests/typecheck
and build run only in GitHub CI. No D1 or schema migration of legacy numeric
IDs, custom sync engine, or Workout Start implementation belongs to this PR.

## Next vertical slice

Verify and activate server ACLs for the Coach PLAN tables, implement a typed
PLAN mutation repository, then migrate Coach editor and Client PLAN read UI.
Workout Start and shared FACT writes require separate subsequent slices.
