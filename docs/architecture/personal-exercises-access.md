# Personal and assigned exercise catalogue — access contract

The global exercise catalogue is immutable. Public exercises are never changed in-place by either coach or client. The legacy `coachExerciseOverrides` table may still have locally synced historical rows; the catalogue projector deliberately ignores them after the 2026-10-15 product decision.

## User-owned content

Every authenticated user (coach or standalone client) can create and edit exercises in their **personal Dexie Cloud realm**, using the existing `coachExerciseDefinitions` table. The historical table name does not indicate an exclusive coach role. The local-first write boundary checks `realmId === owner === actorUserId`. Editing someone else's row is rejected. Each copy has an independent `custom:<UUID>` ID; source records remain unchanged.

- **Вся база** — immutable public rows.
- **Мои упражнения** — exercise definitions in the current user's personal realm.
- **Избранное** — user-owned references to currently available public, personal, or relationship-assigned exercises.
- **Основные** — deliberately remains a placeholder.

Selecting **Изменить** on a public or trainer-assigned exercise requires the `MezfitDialog` copy confirmation, then persists a new personal definition. Editing an already-owned definition opens the personal editor directly, without a copy dialog. The FAB creates a personal definition directly; neither the client mode nor the copy operation requires a coach.

## Client "Тренерские" tab

This tab exists **only in client mode** and displays **only those authored exercises included in program exercises assigned by the currently selected coach in the existing accepted coach-client relationship**. It must not list or query the coach's entire private `coachExerciseDefinitions` table. The client cannot mutate the original trainer-owned definition.

The read repository filters by the authenticated client ID and selected coach ID; every candidate plan passes canonical two-member relationship authorization, v6 author ownership validation, and nested realm/parent checks before rendering. Each program exercise must contain a **full, validated immutable catalogue definition** with the coach's identity bound in `CloudWorkoutExerciseSnapshot.catalogueCoachUserId`. Previous short legacy snapshots remain valid for workout/FACT display but do **not** expose a full editable exercise in "Тренерские". When the PLAN exercise-assignment writer is implemented, it must capture that complete snapshot in the relationship realm at assignment time. Changing a coach's private original later must not silently rewrite already-assigned snapshots.

Switching the selected coach invalidates the prior selected coach's exercise projection immediately, not only after the next database observation. Revoked/unaccepted relationship access fails closed. A client copying an assigned exercise goes back through this authorization path at save time.

## UIkit dependency

`LiquidGlassTextOnly` currently uses intentionally fixed content-sized slots and a narrower internal `.text-only-stage`. The catalogue does not override those internal mechanics. User-requested adaptive equal-distribution slots require a **separate, explicitly approved UIkit primitive extension**: preserve natural widths when the total exceeds the viewport and scroll; otherwise expand each slot equally to fill the viewport, keeping labels centered. This change is not included in the catalogue PR.

## Rollout

All private tables were added under Dexie v5 through the protected GitHub Actions schema flow. This PR reuses them without privileged credentials, new roles, or a new cloud schema. Validation of two real identities and production ACL isolation is required before claiming live multi-account authorization has been verified.
