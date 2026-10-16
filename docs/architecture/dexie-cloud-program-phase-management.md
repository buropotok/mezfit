# PLAN program and phase management — guarded rollout

## Scope

This increment implements program / phase metadata and their lifecycle only.
No day, exercise or set editor is enabled. Workout Start, immutable session
snapshots, scheduling and FACT remain on their existing owners.

Phase lifecycle: `draft`, `pending`, `active`, `finished`, `cancelled`.
`draft` means authoring and is never projected to the client;
`pending` means the coach has published the phase, even when no days exist.
Programs are `draft`, `active`, `finished` or `cancelled`; the client directory
displays personal programs and all non-draft assigned programs from connected
coaches. Assigned details project only non-draft phases.
Finishing a phase keeps its parent program active so completed phases remain
visible in that projection. Finishing the entire program is a separate action.

Activating an empty phase is **temporarily permitted**, solely to exercise
status flows during development. [Issue #424](https://github.com/buropotok/mezfit/issues/424)
requires rejecting an empty selected active phase once the full
program → phase → day → exercise → set vertical slice is available.
Publishing empty pending phases must remain supported permanently.

## Dexie Cloud identity and domains

Do not use the reserved `owner` property as athlete identity. Dexie Cloud Addon
may automatically assign an inserted record to its creator, even when `owner:null`
was passed. New personal PLAN headers therefore belong to the athlete, while
new assigned PLAN headers belong to the authorized coach. Existing Worker-created
ownerless headers remain readable; a client-owned assigned PLAN is rejected by
the repository. `athleteUserId` identifies the athlete independently of ownership.
Relationship plans use an existing Worker-verified coach/client realm and preserve
both role IDs; personal programs use the actor's built-in private realm and
`coachUserId:null, clientUserId:null`, without a dummy client.

The new repository uses existing `trainingPlans` and `programPhases` records.
Existing Dexie **v5** belongs to the coach-private exercise catalogue and stays
unchanged. Dexie **v6** adds indexed PLAN status predicates:
`trainingPlans.[realmId+status]` and both `programPhases.[trainingPlanId+status]`
and `programPhases.[realmId+status]`. Version 6 preserves all coach exercise
tables and the older v1–v5 upgrade history. `durationWeeks` and `athleteUserId`
are ordinary attributes; older relationship plan rows without `athleteUserId`
fall back to `clientUserId`, and older phases display 10 weeks.

Program/phase activation uses native compound-index ranges with
`where('[realmId+status]')` / `where('[trainingPlanId+status]').equals(...).modify(...)`,
not locally enumerated row IDs. This allows a later offline client
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

FAB: `+ Фаза` opens a phase naming dialog; `+ День` is disabled until the next PR;
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
The read-only sync diagnostic also reports whether the synced global Coach
role permits `programPhases`; a connected session alone does not prove that
permission. A missing permission requires the owner-controlled ACL import,
not a frontend workaround or a different local store.
Test that clients cannot modify PLAN, and that a coach can create and rename
a phase in an assigned realm. Confirm private-realm programs still work.
Only then set the GitHub Actions variable
`VITE_CLOUD_PROGRAM_MANAGEMENT_ENABLED=true`, which
`.github/workflows/deploy.yml` forwards to the production Vite build.
When unset, the feature stays disabled by default.

The PLAN detail editor reads the Addon's `db.cloud.syncState` directly through
the shared `CloudConnectionsProvider` (distinct from cached-contact readiness).
Its `pending`, `offline` and `error` phases warn that PLAN changes are not yet
confirmed in Dexie Cloud, even when contacts are still locally readable. A
retry requests `push` for queued PLAN writes followed by `pull`; only the
Addon reporting `in-sync` with a connected session confirms sync. Failed
initial coach-directory hydration displays an error and Retry rather than
claiming the client has no coach. A successful local edit must never be
presented as confirmed cloud persistence.

Do not remove current D1 routes or their tests while a production rollout
still depends on the disabled fallback. A subsequent cutover cleanup may delete
those obsolete paths only after the cloud editor is live and verified.

## Client personal programs and multi-coach behavior

The Client Programs screen always displays two consecutive sections without
source tabs:

- **Мои программы** — programs created in the athlete's private realm, editable
  through the shared program/phase editor. An empty section displays
  “Мы не создали ни одной личной программы” directly on the page background.
- **Тренерские программы** — read-only lists grouped by coach, including active,
  finished and cancelled assigned programs from every readable relationship.
  Draft programs and draft phases are excluded by the repository projection.

Selecting a row opens separate program details; Back returns to the directory.
Status filters apply to both sections. Coach Mode follows the same structure,
with personal programs first and **Программы клиентов** grouped by client.
Client writes do not grant any additional shared-realm PLAN rights.

Program creation uses a dedicated `MezfitBottomSheet` client picker. It reuses
the Clients screen's alphabetical contact list and avatars, with a
`MezfitSearchbar` using `modalTuned`, optics disabled and provider-managed blur.
The creation form owns its draft while the picker is open. Navigation Back
returns from picker to form before closing the form.

The one-active-program invariant is scoped to the **one shared realm for the
coach-client relationship**; one athlete may have one active program with Coach A
and another with Coach B. The athlete's private realm has its own independent
one-active-program limit. No cross-realm activation coordinator is required.

The program screens are disabled behind the rollout flag until protected server
permissions have been reviewed and applied. Creating personal programs does
not require broadening shared-realm Client rights: the athlete is already
authorized to manage their own personal realm.


## System review follow-up

All authoring and read-only PLAN surfaces use `PlanSyncNotice`: program list,
phase editor and the selected coach program. It observes the same Addon sync
projection, never treats a local successful mutation as cloud confirmation, and
retries queued writes. Failed contact hydration is retried separately even when
pushing fails, so a contact error cannot suppress a PLAN retry or remain stuck
behind a successful push. Observer errors can re-subscribe without reloading the app.

The client account and selected program key their respective working surfaces.
Changing accounts destroys the previous subscription and dialog state; a late
callback cannot show the previous account's programs. Directory visibility does
not depend on the globally selected coach.

Header copy/delete guards inspect all same-realm child days regardless of `owner`.
They deliberately do not reuse the owner-filtered UI projection. Malformed phase
headers stop a copy/delete rather than silently losing part of a plan. Child writes
recheck the parent identity inside their local transaction, preventing orphan phase
creation if the parent was deleted between authorization and the write.

Regression coverage includes an accepted Worker-generated coach/client relationship,
all client attempts to mutate its assigned PLAN, unrelated-user reads, parent deletion
before child writes, Addon-owned days, both Client sections, account changes with late
observer callbacks, offline/error/pending/recovery, and duplicate retry taps. Mocked
repository tests do not replace live cloud authorization and multi-device validation;
those remain required before enabling the feature flag as specified above.
