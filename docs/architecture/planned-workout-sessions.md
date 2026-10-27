# Planned workout sessions — DRAFT proposal

Status: **not user-approved and not activated**. Both the local scheduled Start
exception and new protected ACL maintenance require an explicit reviewed user
activation decision. This proposal does not supersede AGENTS.md §21 or the
server-confirmed scheduled Start contract in `local-first-storage-sync.md`.
The approved ad-hoc exception does not authorize scheduled Start.

## Proposed local execution contract

After approval only, the typed local repository would materialize a complete
scheduled execution graph and link its occurrence in one atomic Dexie transaction.
Execution reuses the existing `adHocSessions`, `adHocExercises`, `adHocSets` tables;
there is no table, index or schema change. Header insertion may include optional
immutable `occurrenceId` and an immutable `occurrencePlan` snapshot. Exercise/set
insertion may include optional immutable `occurrenceExerciseId`/`occurrenceSetId`.
These are add-time fields, **not new update grants**. Keep source PLAN unchanged;
later occurrence/source edits cannot rewrite the accepted execution snapshot.
Existing non-scheduled ad-hoc records remain valid without those optional fields.

The proposed transaction includes occurrence `status`/`workoutSessionId` updates,
the header and all initial children. A failure must leave no partial graph or link;
repeated Start must reuse the accepted graph. Local eligibility uses the authorized
local subset and accepted occurrence snapshot, without HTTP, wait-for-sync or
cloud-template revalidation. Addon owns replication. No server-atomic import or
cross-device uniqueness guarantee is implied by a local transaction.

Relationship rows retain their own relationship `realmId` and `owner: realmId`
sentinel on every row. Personal rows retain the actor's personal realm/ownership.
Parent IDs and provenance do not grant access. Existing identity, realm, owner,
athlete, creator and parent keys remain immutable. Existing tombstone and FACT
rules remain unchanged. A role add grant alone cannot enforce insertion ownership
or cross-record linkage; real-server structural permission evidence is required.

`src/data/cloud/planned-session-release.ts` owns the disabled release gate
`PLANNED_SESSION_LOCAL_START_APPROVED`. Until an
explicit reviewed activation decision, **personal scheduled Start is also gated
locally**, even though personal owner privileges may already permit writes without
this role delta. UI visibility, successful preview, merged code, an environment
variable or the existing ad-hoc approval must not enable this exception. This gate does not replace structural authorization.

## Exact role proposal

`cloud/planned-session-roles.json` is a draft overlay, not a standalone CLI import.
The operator imports the exact `EXPECTED_ADHOC_ROLES` baseline from
`tools/dexie-roles/adhoc-sessions.mjs`, clones it and appends only:

| Target | Additional update fields |
| --- | --- |
| `coach.permissions.update.workoutOccurrences` | `status`, `workoutSessionId` |

Every other Coach property/grant and the complete Client role remain unchanged.
In particular no new source PLAN, FACT, manage, delete, add, membership, schema
or business data changes are proposed. Snapshot/provenance fields above are not
added to any update allowlist. `cloud/roles.json`, existing ACL operators and
membership verification are untouched; membership-profile compatibility must be reviewed before activation.
Client receives no scheduled lifecycle write grant in a relationship realm.

The pure planner accepts only the exact ad-hoc Coach profile or exact proposed
Coach profile, plus exact baseline Client. Partial field installation, reordered
field arrays, historical calendar-only roles and arbitrary drift fail closed.
Unrelated roles and export metadata are retained, never normalized. Existing
`workoutOccurrences` and all three ad-hoc tables must already have `@id` keys;
missing/incompatible tables fail closed rather than being repaired.

The generated review payload contains only the full proposed Coach replacement
(or `{}` when already installed), never schema, Client, other roles or data.
JSON object key order/formatting is immaterial; arrays and every value are exact.

## Preview only today

`.github/workflows/dexie-planned-sessions.yml` has only manual `workflow_dispatch`
with `operation` choices `[preview]`, main/ref and repository-owner restrictions,
the existing reviewer-protected `dexie-production` environment and existing
`DEXIE_CLOUD_WRITE_KEY` environment secret. It reuses
`tools/dexie-schema/manage.mjs prepare`, pinned CLI `dexie-cloud@3.0.7` and the
shared writer concurrency group `dexie-public-catalogue-publishing`. Keep required
reviewers and main-only environment protections. No new credentials or accounts.
There are no PR/push/issue triggers, bypass checkbox, apply job or import command.
No workflow was dispatched and no cloud write was performed for this proposal.

Preview exports full schema/roles before planning, re-exports/rechecks the entire
configuration, then exports/verifies final schema/roles equal the originals.
It validates the exact generated payload at recheck/readback. It does not claim
the target was installed. Payload and exports stay private in the credential
directory and are removed with `always()`; they are never uploaded as artifacts.
Errors report fixed codes instead of unknown cloud values or third-party bodies.

The CLI supports only `preflight`, `plan`, `recheck`, `verify` for preview. An
`apply` operation is refused unless `PLANNED_SESSION_LOCAL_START_APPROVED` is
exactly `'true'`, and **is still unconditionally refused when it is true** because
no apply implementation exists. The marker is not a workflow input. The reserved
future fixed confirmation is `APPLY_PLANNED_SESSION_COACH_ACL`; it authorizes
nothing in this draft. There is no runnable apply path, including a disabled job.

## Requirements for a future approved activation PR

Only after explicit user approval may a subsequent reviewed PR enable apply.
It must require the release-approved local Start decision, the exact approval
environment marker and fixed confirmation, with no user-input bypass checkbox.
Main decides how the trusted approval marker and local runtime gate are released.
Preserve the protected environment, existing credential preparation, manual
main/owner restrictions and shared writer lock.

That future operator must create its own initial preview, export both complete
schema and role envelopes immediately before import, use
`assertUnchangedBeforeApply` on those full envelopes and
`assertExactImportPayload` on the exact freshly planned payload. Unknown baselines
fail closed. Import only the proposed Coach replacement, with no schema/data.
Mark an import attempt **before** invoking the CLI. Read back full schema and
roles after every attempt, including a nonzero/failed import; do not let Actions'
implicit `success()` suppress readback. A no-op apply still exports and verifies
live full readback. Cancellation may prevent readback and must block activation.

`verifyPlannedSessions` is pure and available for review now: it requires unchanged
full schema (including seal, tables and metadata) and exact full roles equal to
the before envelope with only the proposed Coach replacement. It supports an
already installed exact target for no-op verification. A failed import that
committed none/part of the delta fails verification; a fully committed delta can
pass readback even when the CLI failed, but the failed job still blocks activation
pending investigation. Do not swallow the import failure or automatically retry.

Configuration import is not a server compare-and-swap or claimed server-atomic
transaction. The workflow lock cannot exclude other administrative writers.
Exclude out-of-band administrators during a future apply; on failure/drift obtain
a fresh protected preview. Never restore a stale full export, roll back schema,
or accept an arbitrary partial baseline to force recovery.

Before activation, main must resolve membership-preflight compatibility separately,
review the runtime release guard for both personal and relationship scheduled
Start, and obtain ordinary-account real-server evidence for Coach's two new
fields, Client denial, immutable provenance/ownership, foreign realm/link rejection
and unchanged source PLAN/FACT access. Configuration readback does not establish
per-user permissions. Required CI and offline transaction/retry verification remain
future integration work; no tests, build or live permission checks were run here.

## Exports for integration review

`CONFIRMATION`, `PLANNED_ROLE_OVERLAY`, `EXPECTED_PLANNED_ROLES`,
`buildExpectedPlannedRoles`, `assertApprovedManifest`, `planPlannedSessions`,
`assertExactImportPayload`, `assertUnchangedBeforeApply`, `verifyPlannedSessions`,
`validatePlannedDispatch`. Importing the module performs no work or network calls.

## Implemented review surfaces

The Training tab's upcoming list reads the same `workoutOccurrences` as Today.
The range is local today through fourteen local dates (upper midnight exclusive),
sorted by start instant and ID. Events, cancelled/started rows and inaccessible
scopes are excluded. The list and calendar reuse `OccurrenceDraftEditor`; the
inline card only adds a persistent timing/disclosure header and lazy body.

A started occurrence projects `occurrencePlan` from its readable linked execution
header. Local content edits, publication, deletion/cancellation and stale queued
PLAN intents reject the exact started-plan message. FACT is independent: planned
execution children retain immutable origin IDs; numeric prescriptions are read
from the frozen header. Planned children cannot be deleted/reordered into a new
PLAN, while added FACT exercises/sets remain separate. Completion updates the
linked occurrence in the same local transaction. No source program is modified
by Start or FACT.

The Start provider serializes the shared UI intent and reports the existing
active-workout dialog. Navigation follows successful acceptance only while the
initiating surface remains current; closing/navigating away suppresses a late
navigation result. No API, manual cloud synchronization or cloud write ran during
implementation. Tests/typecheck/build belong to PR CI; passing static review is
not evidence of real-server authorization or a tested phone layout.
