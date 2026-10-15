# PLAN program and phase management — guarded rollout

## Scope

This increment implements program / phase metadata and their lifecycle only.
No day, exercise or set editor is enabled. Workout Start, immutable session
snapshots, scheduling and FACT remain on their existing owners.

Phase lifecycle: `draft`, `pending`, `active`, `finished`, `cancelled`.
`draft` means authoring and is never projected to the client;
`pending` means the coach has published the phase, even when no days exist.
Programs are `draft`, `active`, `finished` or `cancelled`; clients display
only their one active program and non-draft phases of that program.

Activating an empty phase is **temporarily permitted**, solely to exercise
status flows during development. [Issue #424](https://github.com/buropotok/mezfit/issues/424)
requires rejecting an empty selected active phase once the full
program → phase → day → exercise → set vertical slice is available.
Publishing empty pending phases must remain supported permanently.

## Dexie Cloud identity and domains

Do not write an athlete ID into the reserved `owner` property. `owner:null`
is deliberate on shared records, so the creator does not bypass role-limited
permissions. `athleteUserId` identifies the actual athlete. Relationship
programs use an existing Worker-verified coach/client realm and preserve both
role IDs; personal programs use the actor's built-in private realm and
`coachUserId:null, clientUserId:null`, without a dummy client.

The new repository operates on the existing v4 `trainingPlans` and
`programPhases` tables. New `durationWeeks` and `athleteUserId` properties
are regular, non-indexed attributes; no v5 table or index migration is needed.
Older relationship plan rows without `athleteUserId` are read using
`clientUserId` as a compatibility fallback. Older phases missing
`durationWeeks` display 10 weeks.

Program/phase activation uses declarative Dexie Cloud `where(...).modify(...)`
predicates, not locally enumerated row IDs. This allows a later offline client
to replay the intention against its server snapshot so that only one program
and one phase are active per relationship realm. If another device activated
an unseen program, the stale program and its active phase revert to
`draft` (rather than falsely claiming they were finished).
Known previous active programs/phases still require the coach's explicit
disposition in the UI.

This increment deliberately copies and deletes only program and phase
**headers without days**, because Coach is not granted permissions for
`programDays`, `programExercises`, or `programSets` yet. Duplicate and
delete refuse to mutate any program/phase containing days. Empty program
deletion uses `programPhases.where('trainingPlanId').equals(id).delete()`
and a parent predicate, so an offline-added phase header is included
when the operation is later replayed on the server. Full descendant
copy/cascade/history guards must be added alongside the day editor and its
explicit server ACL permissions, not silently simulated in this PR.

## UI primitives

- `GlassSurface preset="modalTuned" optics={false}`: local layout only;
  blur inherited from `GlassSurfaceProvider`.
- `LiquidPopover`: material resolved through existing glass settings.
- `MezfitDialog` / `MezfitDialogButton`: prompts, list selectors, confirms.
- Icon names are sourced from the existing Tabler SVG registry.

FAB: `+ Фаза` creates immediately; `+ День` is disabled until the next PR;
`+ Упражнение` is removed from the FAB.

## Permission and activation gate

The desired `cloud/roles.json` policy now allows Coach to `manage`
`trainingPlans` and `programPhases` only. It does **not** grant Client PLAN
writes or any new FACT/immutable session permissions.

**Committing `cloud/roles.json` does not deploy Dexie Cloud roles.**
The existing protected GitHub Actions `dexie-production` write key is
restricted by `AGENTS.md` §21 to public-catalogue and additive schema tasks.
Neither its existing workflow nor a generic PR workflow may import roles.
Do not modify those workflows or reuse that credential for role changes.

Staged production rollout order matters: (1) deploy the compatibility Worker
that accepts only the exact old `manage: ['trainingPlans']` and new
`manage: ['trainingPlans', 'programPhases']` Coach policies; Client FACT
permissions must match the existing exact whitelist throughout; (2) use an
owner-approved separate process to import the new ACL; (3) verify role
membership and Coach/Client authoring with real accounts; (4) enable the
frontend flag. **Never import ACL ahead of the compatible Worker**, since the
older Worker would reject invitations after the ACL change. Remove temporary
legacy-role acceptance after the rollout is complete and confirmed.

New Coach/Client program screens remain OFF by default behind
`VITE_CLOUD_PROGRAM_MANAGEMENT_ENABLED=true`. Enable only after an authorized
human operator has reviewed/deployed the minimum role change through an
approved owner-controlled route and verified the installed roles and isolated
write/read behavior with real Coach A / Client B / Client C identities.
Test that clients cannot modify PLAN, and that a coach can create and rename
a phase in an assigned realm. Confirm private-realm programs still work.
Only then enable the flag in the deployed build configuration.

Do not remove current D1 routes or their tests while a production rollout
still depends on the disabled fallback. A subsequent cutover cleanup may delete
those obsolete paths only after the cloud editor is live and verified.

## Client personal programs and multi-coach behavior

The Client Programs screen has two surfaces:

- **От тренера** — read-only, displays the active program assigned by the
  **currently selected coach** and its non-draft phases. It does not show
  programs from other coaches or the client's personal programs.
- **Мои программы** — edits programs the athlete created inside their
  personal realm using the same program/phase editor as Coach Mode. These
  are completely independent of assigned coach-controlled PLAN records.
  Client writes must not grant any additional shared-realm PLAN rights.

The one-active-program invariant is scoped to the **one shared realm for the
coach-client relationship**; one athlete may have one active program with Coach A
and another with Coach B. The athlete's private realm has its own independent
one-active-program limit. No cross-realm activation coordinator is required.

The program screens are disabled behind the rollout flag until protected server
permissions have been reviewed and applied. Creating personal programs does
not require broadening shared-realm Client rights: the athlete is already
authorized to manage their own personal realm.
