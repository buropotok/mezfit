# Coach ad-hoc workout sessions

Status: implementation and protected activation contract; **not live validated**.
The user explicitly approved replacing server-confirmed ad-hoc Start and completion
with atomic local Dexie transactions and Addon replication. This exception does
not change scheduled workout Start, occurrence lifecycle, or existing FACT grants.
The separately approved Coach planned-session extension is documented in
`planned-workout-sessions.md`.

## Coach entry points

The Coach Training tab uses the cloud repository. The Client Training tab
subscribes to active Coach-owned FACT sessions in the client's authorized shared
realms and displays them read-only, including subsequent FACT updates. When no
such active session is available, Client mode retains its existing session
screen. Completed FACT history and calendar placement are separate decisions. The shell-owned plus action opens LiquidPopover with Quick,
From program and Planned workout. Quick immediately opens a blank personal
session and never creates a program. From program asks for the coach or a client,
then reuses program-day cards with a treadmill Start action. Starting copies only
exercise/set structure and set types; numeric PLAN is absent. Previous results
are an empty placeholder, with a typed `previousSets` input on the session screen
for later history integration.

If the selected athlete has no accessible program, a single local transaction
creates the default program, phase, day and blank session. The bottom toast says
“Была создана программа.” Completion always persists the session; only this
automatically linked case asks “Сохранить шаблон тренировки в программе?” Yes
updates that day with exercises/order and sets/order/type only. No leaves the
program unchanged. A pending choice survives reopening. Existing program days
are not automatically overwritten. The former Planned-workout placeholder is replaced by the separate two-week list
and shared collapsible editor described in `planned-workout-sessions.md`.

## Persistence and lifecycle

The Coach repository owns three new synchronized tables, each with stable
client-generated IDs and cloud primary key `@id`:

| Table | Content | Coach update allowlist |
| --- | --- | --- |
| `adHocSessions` | Ad-hoc header and lifecycle | `name`, `comment`, `status`, `completedAt`, `templateSaveDecision`, `updatedAt` |
| `adHocExercises` | Session exercise snapshot and order | `position`, `deletedAt`, `notes` |
| `adHocSets` | Per-set FACT and order | `position`, `deletedAt`, `setType`, `actualReps`, `actualWeightKg`, `actualDurationSeconds`, `actualDistanceMeters`, `setLabel`, `rpe`, `comment`, `bands`, `setStatus` |

Start creates its complete initial local session graph in one Dexie transaction.
Completion changes the local header and any required related records atomically;
`templateSaveDecision` belongs to that acceptance. Neither action awaits HTTP,
cloud push, or a remote business-state check. Addon alone owns replication and
retries. The UI reports local acceptance separately from synchronization state.
A failed local transaction leaves no partial graph; repeated user actions must
reuse/reopen the accepted session rather than create duplicate sessions.

Exercise and set removal uses `deletedAt` tombstones, never DELETE. Parent-child
identity, athlete, creator, owner, realm and ID are immutable after insertion;
changing them is not part of an ordinary edit or reorder. Do not expand an update
allowlist to repair a wrong parent. Existing source programs, scheduled
occurrences and scheduled session tables are outside this lifecycle.

Every relationship row, including children, has its own relationship `realmId`
and **`owner: realmId`** (a non-user sentinel), preventing ordinary participant
ownership from bypassing role restrictions. Personal rows use
`realmId: actorUserId` and `owner: actorUserId`; personal owners have Dexie Cloud
owner privileges and must not be mistaken for restricted relationship members.
Parent IDs do not grant access. The local repository checks the actor, target
relationship, athlete and complete graph at acceptance. A client has read-only
access to these new relationship tables in this Coach-only slice; this does not
change the existing shared FACT policy on the scheduled tables.

## Exact cloud operation

`cloud/adhoc-session-roles.json` is an **overlay**, not a full role export and not
a standalone CLI import file. `cloud/roles.json` remains the calendar baseline.
The operator embeds an independently frozen calendar profile, the exact overlay
and the exact three-table schema. Changing only a manifest cannot broaden the
operation. The operator constructs a full replacement Coach role by retaining
every baseline property and appending only the reviewed add/update grants.
Client and all other roles remain byte-semantically unchanged, including field
array order and metadata; JSON object formatting/key order is immaterial.
No new manage/delete grant, realm membership change or business write is allowed.

`tools/dexie-roles/adhoc-sessions.mjs` exports:

- `EXPECTED_CALENDAR_ROLES`: exact old Coach/Client profile.
- `ADHOC_ROLE_OVERLAY` and `ADHOC_SCHEMA`: frozen approved additions.
- `buildExpectedAdHocRoles(calendarRoles?)` and `EXPECTED_ADHOC_ROLES`: exact
  expanded profile; an optional baseline must equal the frozen calendar profile.

Membership preflight integration must accept either exact old profile or exact
expanded profile, preserving its other structural checks. Do not accept a union,
subset or arbitrary superset of grants. That integration is owned separately.
Install the approved current calendar policy first; this operator does not retire
historical scheduling-request roles or upgrade old calendar grants.
After expansion, the existing calendar-only operator will reject the expanded
Coach profile; do not use it as a rollback or edit its baseline to bypass that
guard. Ordinary scheduled-workout permissions remain unchanged.

The explicitly approved exception permits a **combined additive schema + scoped
Coach ACL import** only through `.github/workflows/dexie-adhoc-sessions.yml`.
It reuses the existing `DEXIE_CLOUD_WRITE_KEY` environment secret in
`dexie-production`, required reviewers and main-only environment protection;
no new credential, account or environment is authorized. Dispatch is manual,
main-only and repository-owner-only. PR/push must never execute it. It shares
`dexie-public-catalogue-publishing` concurrency with existing protected writers
and the pinned Dexie Cloud CLI/version and private credential directory of the
local-calendar operator. No existing operator is widened.

Preview exports only schema and roles, validates both manifests and installed
Coach/Client profiles, and reports fixed approved table/role names. It writes no
remote configuration or business data. Apply additionally requires the literal
`APPLY_ADHOC_SESSION_SCHEMA_AND_COACH_ACL`. Immediately before import it re-exports
both complete configuration envelopes and compares them exactly with the run's
initial exports, then verifies the generated payload exactly. A fresh apply run
creates its own preview; it does not consume a prior run's payload.

The import contains only missing reviewed schema entries and, when necessary,
the full exact expanded Coach role. Existing compatible tables and an already
expanded Coach role are accepted for idempotency and interrupted-import recovery.
Conflicting keys and any other Coach/Client drift fail closed. Full post-attempt
schema and roles readback must equal the initial envelopes plus precisely those
approved changes, including unchanged seal, existing tables, unrelated roles and
export metadata. A no-op apply still verifies live readback. Import failure does
not suppress readback; job cancellation may prevent it. Credentials, generated
payload and private exports are cleaned with `always()` and never uploaded as
public artifacts. Errors do not dump unknown cloud values or secret-bearing
third-party responses.

The configuration import is **not claimed to be a server-atomic transaction**.
The shared workflow lock cannot exclude out-of-band administrative writers, and
the export/recheck/import interval is not a server compare-and-swap. Operators
must exclude other administrators during apply. On failure, cancellation or a
mismatched readback, block activation and inspect a fresh protected preview.
Never undo a partial import by dropping tables or restoring a stale full export.
Only an exact supported partial state may be completed by a fresh reviewed run.

## Activation and real server permission checklist

No live operation or server permission test was executed for this implementation.
Configuration comparison and mocked/unit tests do not prove server authorization.
Activation requires the following evidence from ordinary authenticated accounts,
without using the publisher credential for product mutations:

1. Review the complete diff, new tests, exact schema and Coach field grants; run
   the required tests/typecheck/build in PR CI. Confirm membership preflight
   accepts both exact profiles and rejects drift before activating the overlay.
2. Verify required environment reviewers, main-only protection, owner-only manual
   dispatch, existing environment-secret placement and shared writer concurrency.
   Run preview on reviewed main. Confirm no unexpected installed policy/schema
   and an independently reviewed exact delta. Dispatch apply with the literal
   confirmation and retain its successful full configuration readback evidence.
3. With a real Coach in relationship A, add a complete graph using the sentinel
   owner on **every** row; edit each allowed field and verify remote readback.
   Confirm Start and completion offline commit atomically, remain editable on
   sync error and replicate via Addon after reconnect without duplicates.
4. With Client A, verify read access and rejection of add, update and physical
   DELETE on all three tables. With Coach/Client B and an unrelated authenticated
   user, verify no reads or writes in relationship A, including guessed IDs.
   Verify revoked/non-member actors cannot add to the relationship realm.
5. As Coach A, attempt every forbidden update: `id`, `realmId`, `owner`, athlete,
   creator, session parent, exercise parent and immutable snapshot/provenance
   fields. Verify rejection remotely, including moves to personal/foreign realms,
   DELETE and a mixed allowed/forbidden patch. Verify tombstones replicate and
   removed exercise/set projections remain hidden after reload/reconnect.
6. Probe malformed insertion ownership and links explicitly: omitted/default owner,
   actor-owned or Client-owned rows in the relationship, foreign parent IDs and
   cross-realm parent references. A role `add` grant is not an insert-field or
   relational constraint. Readback must prove the owner sentinel is retained;
   confirm whether the server prevents ownership escalation and foreign linking.
   If the installed server cannot enforce required boundaries, **do not activate**
   the slice; obtain a separately reviewed structural authorization solution.
   Frontend checks and this configuration operator cannot establish those facts.
7. Test personal actor-owned graphs separately. Owner privileges differ from
   relationship grants; prove no personal row grants access to another user's
   private data. Recheck scheduled Start/completion, PLAN and existing FACT
   permissions are unchanged. No ad-hoc grant may authorize scheduled lifecycle.
8. After interrupted import or unexpected result, stop activation, perform fresh
   protected read-only inspection and resolve only the reviewed missing delta.
   Do not advertise remote persistence until Addon confirms it.

## Review note

Audit findings A-002/A-003/A-005/A-010 remain review context where applicable to
ownership, server permission evidence and protected activation. This change does
not claim to close them through a role manifest or a configuration readback.
The root integration review owns any remaining final user approval decision.
