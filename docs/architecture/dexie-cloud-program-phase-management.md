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

Multi-record program and phase status transitions use one local Dexie
transaction and existing Dexie Cloud synchronization. Exactly one active phase
is required in an active program. Changing an active phase to an inactive
status also deactivates the parent program; switching programs deactivates the
previous program and its active phase. Deletion blocks if an active phase,
workout history or scheduled occurrences would be invalidated. Deep duplication
copies existing descendants and resets every copied phase/program to draft.

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

## Known cross-realm boundary

The current repository ensures one active program among the actor's
**locally visible and writable** athlete programs. An athlete belonging
to multiple unrelated coach realms requires an explicitly authorized
cross-realm coordinator for a *global* single-active-program invariant.
Do not claim this invariant is server-global before that backend
capability exists. Resolve before multi-coach simultaneous activation rollout.
