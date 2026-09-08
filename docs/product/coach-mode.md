# Coach Mode — Client Workspace

## Purpose

The selected client is the coach's primary working context. The client page is not a passive profile or a generic statistics dashboard; it is a cockpit for understanding the client's current state and taking the next coaching action.

Mezfit priority: **M**.

## Client workspace navigation

```text
Client
├── Overview
├── Program
├── Exercises
├── Calendar
├── Progress
└── History
```

### Overview

Overview should answer quickly:

- What program is active?
- What was the latest workout and how did FACT differ from PLAN?
- What is the next planned workout?
- Is a workout currently in progress?
- What changed recently?
- Is there information that should cause the coach to adjust future prescription?

The screen should prioritize operational information over a dense BI dashboard.

Representative content:

```text
Andrey
Hypertrophy 3 Days

LAST WORKOUT
Today · Workout A · completed
14 / 15 sets

Bench Press
Plan: 85×8×3
Fact: 85×8 / 85×8 / 85×6

NEXT
Friday · Workout B
[Edit future plan]

30 DAYS
Workouts 10 / 12
Sets 94%
Weight 78.4 → 76.9 kg
```

### Exercises — first-class quick action

`Exercises` must be directly reachable from the main client workspace. It is not merely a drill-down from the current Program.

It contains every exercise for which the client has ever recorded an actual `ExerciseResult`, even when:

- the exercise was removed from the current program;
- the program was replaced;
- an old workout definition no longer contains it;
- the exercise is archived from future prescription.

The source of this view is historical FACT (`WorkoutSession → ExerciseResult → SetResult`), not the current program structure.

Example:

```text
Andrey → Exercises

Search…

Recent
Bench Press
Squat
Lat Pulldown

All exercises
Barbell Curl
Bench Press
Deadlift
Leg Press
...
```

Opening an exercise shows client-specific chronological performance history. Full history is **M**; derived charts/records are **C**.

`Exercises` and `History` are different projections:

- **Exercises** — “show everything this client has ever done for Bench Press.”
- **History** — “show this client's workouts chronologically.”

## Previous → Plan → Fact

This is the primary analytical pattern for coach-side workout analysis.

```text
                 Previous      Plan       Fact
Bench set 1      82.5×8        85×8       85×8
Bench set 2      82.5×8        85×8       85×8
Bench set 3      82.5×8        85×8       85×6
```

It lets the coach compare previous capability, current prescription, and actual execution without navigating between screens.

Mezfit priority: **M**.

## Analytics-to-action rule

Where analysis naturally suggests changing a future prescription, editing must be reachable directly from that context.

Examples:

- Overview → edit future workout;
- Program → edit workout/exercise/set prescription;
- Exercises → inspect exercise history → edit the next occurrence containing that exercise;
- History → inspect past FACT → navigate to relevant future prescription.

All shortcuts must converge on the same underlying prescription editor. They must not implement separate editing semantics.

## Program editing levels

Coach should be able to reach:

1. program-level editing;
2. workout-level editing;
3. exercise-level editing;
4. planned-set/load/reps/rest/instruction editing;
5. add/remove/reorder exercise actions.

The editor should retain client context and expose relevant previous performance next to the prescription being changed.

## In-person coaching

Coach may record FACT for the client during an in-person session. This uses the same `WorkoutSession`, `ExerciseResult`, and `SetResult` entities as client-entered results.

There is no separate coach workout copy.

```text
Coach ───┐
         ├── shared WorkoutSession
Client ──┘
```

A session can contain results recorded by both roles. Persist authorship/audit metadata such as `created_by_user_id` / `updated_by_user_id` or equivalent.

Mezfit priority: **M**.

## Plan locking in coach UI

When a specific `WorkoutOccurrence` becomes `IN_PROGRESS`, its plan is locked.

Example:

```text
8 Sep   Workout A   IN_PROGRESS   locked
10 Sep  Workout B   SCHEDULED     editable
15 Sep  Workout A   SCHEDULED     editable
```

The coach must see the lock and may inspect FACT, but cannot change that occurrence's PLAN. Other future occurrences remain editable.

The backend must enforce the lock on mutation. UI state alone is insufficient because the client may start while the coach has an editor open.

A stale coach save must fail with a domain conflict (for example `PLAN_LOCKED`) and refresh the occurrence state.

## Progress and operational analysis

Coach progress views should be client-specific and decision-oriented. Useful projections include:

- scheduled vs completed workouts;
- completed planned sets;
- exercise progression;
- body measurements;
- progress photos;
- recent notes/Telegram references.

Avoid judgmental interpretation. Prefer deterministic facts such as “10 of 12 scheduled workouts completed” over labels such as “poor adherence.”

Priorities:

- client workout/exercise history: **M/S** depending on depth;
- adherence summary: **S**;
- measurements: **S**;
- photos: **S/C**;
- derived charts/records: **C**.
