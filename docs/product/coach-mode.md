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

## Overview

Overview should answer quickly:

- What program is active?
- What was the latest workout and how did FACT differ from PLAN?
- What is the next planned workout?
- Is a workout currently in progress?
- What changed recently?
- Is there information that should cause the coach to adjust future prescription?

The screen prioritizes operational information over a dense BI dashboard.

## Exercises — first-class quick action

`Exercises` must be directly reachable from the main client workspace. It is not merely a drill-down from the current Program.

It contains every exercise for which the client has ever recorded an actual `ExerciseResult`, even when the exercise is no longer in the current program. Its historical source is FACT (`WorkoutSession → ExerciseResult → SetResult`), not current program structure.

`Exercises` and `History` are distinct projections:

- **Exercises** — everything this client has ever done for one exercise.
- **History** — the client's workouts chronologically.

## Previous → Plan → Fact

This is the primary analytical pattern for coach-side workout analysis.

```text
                 Previous      Plan       Fact
Bench set 1      82.5×8        85×8       85×8
Bench set 2      82.5×8        85×8       85×8
Bench set 3      82.5×8        85×8       85×6
```

It lets the coach compare previous capability, current prescription, and actual execution without navigating between screens.

## Analytics-to-action rule

Where analysis naturally suggests changing a future prescription, editing must be reachable directly from that context. Overview, Program, Exercises and History shortcuts must converge on the same underlying prescription editor rather than creating separate editing semantics.

## Program editing levels

Coach should be able to reach:

1. program-level editing;
2. workout-level editing;
3. exercise-level editing;
4. planned-set/load/reps/rest/instruction editing;
5. add/remove/reorder exercise actions.

The editor retains client context and exposes relevant previous performance next to the prescription being changed.

## In-person coaching

Coach may record FACT for the client during an in-person session. This uses the same `WorkoutSession`, `ExerciseResult`, and `SetResult` entities as client-entered results. There is no separate coach workout copy.

A session may contain results recorded by both roles. Persist authorship/audit metadata.

## Plan locking in coach UI

When a specific `WorkoutOccurrence` becomes `IN_PROGRESS`, its plan is locked.

```text
8 Sep   Workout A   IN_PROGRESS   locked
10 Sep  Workout B   SCHEDULED     editable
15 Sep  Workout A   SCHEDULED     editable
```

The backend must enforce the lock. If the client starts while the coach has a stale editor open, save must fail with a domain conflict such as `PLAN_LOCKED`; the UI refreshes and explains that the workout has started.

## Progress and operational analysis

Useful client-specific projections include scheduled vs completed workouts, completed planned sets, exercise progression, body measurements, progress photos and recent Telegram-linked notes. Prefer deterministic facts over judgmental interpretation.
