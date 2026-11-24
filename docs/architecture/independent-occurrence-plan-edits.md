# Editing an independent scheduled workout PLAN

**Decision:** Approved by the owner on 2026-11-20.
**State:** App/repository implementation and protected ACL preparation; live ACL activation is separate.

## Business contract

- An authorized Coach may replace and delete exercises in a Client's unstarted scheduled occurrence in either `coached` or `independent` format, regardless of whether it was opened from the calendar, profile or a discussion.
- An athlete may edit their own unstarted `independent` occurrence even when its source training program was assigned by a Coach. The same rule applies through the Client's planned-workout picker and profile. A Client cannot edit a `coached` occurrence PLAN.
- Source `trainingPlans/programExercises/programSets` remain Coach-controlled and unchanged. All occurrence edits are made to the independent self-contained snapshot, preserving `originalPlan`, source identifiers, athlete, Coach, relationship realm and workout timing.
- After Start the accepted PLAN is frozen. Session FACT has separate rules: an exercise added during execution may be replaced/deleted while the session remains active; an exercise from the accepted occurrence PLAN may not.
- Clicking unavailable Replace/Delete shows the specific reason in `MezfitDialog` with a dismissal control rather than leaving a disabled, unexplained command. Ordinary pending/busy states do not enable duplicate edits.
- Replace preserves sets/metrics only for matching tracking types; other choices require explicit confirmation to replace without retaining them.

## Local-first persistence and screens

The editor uses `WorkoutOccurrenceDraftRepository.enqueueEdit()` and its existing atomic transaction/queue. Editing a published occurrence changes `publicationStatus` to `draft`, preserves its published backup, and leaves replication to Dexie Cloud Addon. Publication uses the existing `save()` path. A profile's open editor keeps its own authorized draft in the existing shared `observeWorkspace` subscription so the sheet stays mounted when the published item leaves the list. No new business database, HTTP transport, manual sync barrier or extra profile observer is introduced.

The typed policy `occurrencePlanEditRestriction` is reused by repository and UI. Server structural permissions (member, realm and field) remain authoritative for synchronization. The client must never use its ability to update an occurrence to edit a source Coach program or someone else's realm.

## Protected Dexie Cloud field grant

Clients previously could only change occurrence timing, publication fields and `draftAuthorUserId`. Editing their own independent occurrence requires adding **only** `plan` and `publishedPlan` to Client `workoutOccurrences` update grants. `originalPlan` and all identity, owner, realm and execution fields remain protected. The Coach role and source-program table grants remain unchanged.

`cloud/independent-occurrence-plan-roles.json` is the exact approved overlay. The protected `tools/dexie-roles/independent-occurrence-plan.mjs` operator accepts only the complete Discussions MVP baseline, optionally with the existing `pendingRepeatRule` grant on both roles. It rejects unknown schema/role drift or partial profiles, preserves every unrelated permission, and verifies the complete schema and role readback, even following a failed import.

The workflow `dexie-independent-occurrence-plan.yml` must run **only** via owner/main manual Preview, then a separately approved Apply. It uses the existing protected writer secret, environment reviewers and shared concurrency lock; never PR or push. Review a no-op or unexpected profile mismatch before any live change.

**Authorization boundary:** Dexie Cloud's current field allowlist grants `plan` updates to Client members of a relationship realm; the list itself does not vary by occurrence's mutable `format` value. Consequently, denying Client edits of `coached` occurrences is a local repository business rule, not an independent cloud row-format ACL guarantee. Source program tables and foreign realms remain protected by structural grants. A stronger malicious-client server invariant would require a separately reviewed authorization architecture, not ad-hoc Worker validation of replicated PLAN snapshots.

## Acceptance checks after explicit activation

1. Coach: replace/delete an independent scheduled Client workout from the Client profile and calendar; publish and reopen without losing the edits.
2. Athlete: replace/delete an independently scheduled workout derived from a Coach-assigned program from the Client calendar, profile and planned workouts screen. Original Coach program and `originalPlan` must not change.
3. Client cannot edit a `coached` PLAN through the supported app/repository; blocked actions display the correct `MezfitDialog`.
4. Started/completed occurrence PLAN remains frozen. In an active FACT session, added exercises remain mutable; frozen PLAN exercises show an explanation dialog.
5. With matching tracking types the replacement offers retention of sets; different types require confirmation of reset. Cancelling never destroys the prior exercise.
6. Real Coach/Client accounts: confirm local commit, Dexie Cloud synchronization and visibility on a second device. Verify foreign realm denial, no new source-program grants and no privilege or schema drift.

Tests/typecheck/build run in the PR's GitHub Actions; do not represent test or live ACL activation as passed merely because this document or PR exists.
