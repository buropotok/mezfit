# Planned workout sessions

Status: **local atomic scheduled Start and scoped Coach ACL maintenance explicitly
user-approved; live activation pending protected manual ACL installation and
ordinary-account real-server permission evidence**. Approval covers this code and
operator, not execution of a cloud write in this development session. No workflow
was dispatched or cloud mutation performed here.

## Local execution contract

The typed local repository materializes a complete scheduled execution graph and
links its occurrence in one atomic Dexie transaction. Addon owns replication;
Start does not await HTTP, a cloud push or cloud-template business revalidation.
This approved scheduled exception extends the approved ad-hoc local lifecycle.
It replaces the earlier scheduled server-confirmed Start requirement for this
slice. It does not introduce a server transaction or cross-device uniqueness claim.

Execution reuses existing `adHocSessions`, `adHocExercises`, `adHocSets`; there is
no table, index or schema change. Header insertion may include optional immutable
`occurrenceId` and an immutable `occurrencePlan` snapshot. Exercise/set insertion
may include optional immutable `occurrenceExerciseId`/`occurrenceSetId`. These are
add-time fields, **not new update grants**. Existing ad-hoc rows remain valid
without them. Source PLAN remains unchanged; later source/occurrence edits cannot
rewrite the accepted execution snapshot.

The transaction includes occurrence `status`/`workoutSessionId` updates, header and
initial children. Failure leaves no partial graph/link; repeated Start reuses the
accepted active graph. Eligibility is checked against the authorized local subset.
Each relationship row retains its relationship `realmId` and `owner: realmId`
sentinel; personal rows retain actor realm/ownership. Identity, realm, owner,
athlete, creator and parent keys remain immutable. Parent/provenance IDs grant no
access. Existing tombstone and FACT rules remain unchanged. An add grant alone
cannot enforce insertion ownership or cross-record linkage.

`src/data/cloud/planned-session-policy.ts` owns the shared `STARTED_PLAN_MESSAGE`.
Personal self Start commits locally; shared `createFromOccurrence` checks installed Coach
grants and realm access. This operator has no approval environment marker or
checkbox. Installing ACL does not replace structural authorization, and code
approval alone does not establish live permissions.

## Exact role delta

`cloud/planned-session-roles.json` is an exact overlay, not a standalone CLI import.
The operator imports `EXPECTED_ADHOC_ROLES` from
`tools/dexie-roles/adhoc-sessions.mjs`, clones it and appends only:

| Target | Additional update fields |
| --- | --- |
| `coach.permissions.update.workoutOccurrences` | `status`, `workoutSessionId` |

Every other Coach property/grant and the complete Client role remain unchanged.
No source PLAN, FACT, manage, delete, add, membership, schema or business data grant
is added. Snapshot/provenance fields are not added to update allowlists.
`cloud/roles.json`, existing ACL operators and membership verification are untouched;
membership-profile compatibility must be reviewed before live activation.
Client receives no relationship scheduled lifecycle write grant.

Only the exact ad-hoc Coach baseline or exact installed target is supported, with
exact baseline Client. Partial installation, reordered field arrays, historical
calendar-only profiles and any other drift fail closed. Unrelated roles and export
metadata are retained, never normalized. Existing `workoutOccurrences` and all
three ad-hoc tables must already have `@id` keys; incompatible/missing tables fail
closed rather than being repaired. JSON object key order/formatting is immaterial;
arrays and all values are exact.

The generated payload is only a full target Coach replacement or `{}` for an
already installed target. It contains no schema, Client, other roles or data.

## Protected manual preview/apply

`.github/workflows/dexie-planned-sessions.yml` accepts only manual
`workflow_dispatch`, on main by the repository owner, with operation choices
`[preview, apply]`. It reuses the reviewer-protected, main-only `dexie-production`
environment, existing `DEXIE_CLOUD_WRITE_KEY` environment secret,
`tools/dexie-schema/manage.mjs prepare`, pinned CLI `dexie-cloud@3.0.7` and shared
writer concurrency group `dexie-public-catalogue-publishing`. No new credential,
account, environment or PR/push/issue trigger is introduced. Keep required
reviewers and main-only environment protection configured.

Apply requires literal `APPLY_PLANNED_SESSION_COACH_ACL`; preview requires blank
confirmation. There is no approval environment variable requirement. Each run
exports its own full initial schema/roles, validates the exact manifest/baseline,
and writes the private `planned-proposal.json` plus `change_count` to
`GITHUB_OUTPUT`. A prior run's payload cannot be reused.

Immediately before import, fresh full schema/roles exports must exactly equal
that run's initial envelopes; the generated payload must exactly equal the
freshly recomputed plan. Preview and no-op apply also perform this recheck.
For a nonempty apply the workflow records `import_attempt` before invoking CLI
import. It then exports full schema/roles and verifies them even when import
exits nonzero. Explicit `!cancelled()` conditions prevent implicit Actions
`success()` from suppressing failure readback. A no-op apply skips import but
still exports and verifies live full readback. Cancellation may prevent readback
and blocks activation.

Preview verification requires complete schema and roles unchanged. Apply
verification requires the full schema unchanged (including seal, old tables and
metadata), and full roles equal the initial envelope with only the exact target
Coach replacement. The exact generated payload is checked again. An import error
may leave none, part or all of the delta: none/part fails target verification;
fully committed changes may pass readback, but the failed job remains failed and
blocks activation pending investigation. Do not swallow errors or auto-retry.

Credentials, payload and private exports remain in the isolated credential
directory, are cleaned with `always()` and are never uploaded as artifacts.
Operator errors emit fixed codes rather than unknown cloud values or potentially
secret-bearing third-party responses.

## Recovery and activation evidence

Configuration import is not a server compare-and-swap. The shared workflow lock
cannot exclude out-of-band administrators; exclude those writers during apply.
On failure, cancellation or drift, block activation and obtain a fresh protected
preview. Only the exact baseline or already installed exact target may proceed;
a partial field grant is not an accepted recovery baseline. Never force recovery
by restoring a stale full export, changing schema or broadening baseline checks.

Live activation remains pending: review membership-profile compatibility and
the personal/shared structural checks, run the protected main preview and separately authorized
manual apply, then obtain ordinary authenticated account evidence for Coach's two
new fields, Client denial, immutable provenance/ownership, foreign realm/link
rejection and unchanged source PLAN/FACT access. Verify offline atomicity,
repeated Start and completion/reconnection behavior. Configuration readback does
not prove per-user authorization. No npm, install, tests, build or real-server
permission checks were executed in this operator update; PR CI owns code checks.

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
