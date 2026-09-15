# Workout Lifecycle and Plan Locking

## Scope

These are product/domain invariants, not merely UI behavior.

```text
ProgramAssignment
  └── WorkoutDefinition / future prescription
        └── Schedule
              └── WorkoutOccurrence
                    └── WorkoutSession
                          ├── plan_snapshot
                          └── ExerciseResult
                                └── SetResult
```

`WorkoutOccurrence` represents an expected/scheduled workout. `WorkoutSession` represents known actual execution.

A workout may also be started outside the program as `Своя тренировка`; such a session has no source program day/occurrence.

## State model

Program-based live workout:

```text
SCHEDULED / AVAILABLE
   │ explicit Start Workout
   ▼
IN_PROGRESS
   │
   ├── explicit Finish
   └── inactivity timeout
          ▼
      COMPLETED
```

Own workout:

```text
NO SESSION
   │ explicit `Своя тренировка`
   ▼
IN_PROGRESS
   │
   ├── explicit Finish
   └── inactivity timeout
          ▼
      COMPLETED
```

Additional occurrence outcomes include skipped/cancelled/rescheduled semantics.

## Global Start / Continue entry point

Client Mode exposes one global workout FAB through the application/navigation shell.

- without an active session: `Начать тренировку`;
- with an active session: `Продолжить тренировку`;
- while already viewing the current active workout: the FAB is hidden.

The global launcher is the canonical entry point. Individual client screens must not own competing workout-start state.

## Start semantics

Live workout start is explicit. Recording the first FACT is no longer the start event.

The launcher resolves the workout source before persistence:

1. if one `program_day` is unambiguously scheduled for the current date, it is preselected and the separate day-selection list is skipped;
2. the user may choose `Сменить день` to select another day from the current phase;
3. the user may choose `Своя тренировка` to start outside the program;
4. if no single scheduled day can be resolved, the launcher presents the current-phase days plus `Своя тренировка`.

A scheduled day is a default/recommendation, not an irreversible choice. Even when the day-selection step is skipped, `Сменить день` and `Своя тренировка` remain available before final Start confirmation.

Opening the launcher, preselecting a scheduled day, or changing the selection must not create a `WorkoutSession`. Session creation happens only after final Start confirmation.

The backend atomically:

1. authenticates/authorizes the actor and verifies that another active session does not conflict;
2. creates the `WorkoutSession`;
3. for a program-based workout, records source program provenance and copies/materializes the selected `program_day` prescription into session-owned exercise/set data;
4. for each planned set, freezes PLAN values in session storage while retaining source IDs only as provenance;
5. for `Своя тренировка`, creates a session without source program day and without mutating the program;
6. transitions the session to `IN_PROGRESS`;
7. sets `started_at` unless manually provided.

No FACT is required to create/start the session.

## Session PLAN ownership

Before Start, the program is the editable prescription source.

After Start, the active workout reads PLAN only from the frozen/materialized session data. The mutable program is no longer the source of PLAN for that session.

Conceptually:

```text
program_day
  └── program_exercise
        └── program_set
              │ Start Workout / snapshot
              ▼
workout_session
  └── session_exercise
        └── session_set.planned_*
```

Program changes after Start affect future workouts only. They never rewrite the PLAN snapshot or FACT of the active/completed session.

## Plan lock

Once a specific occurrence/session is `IN_PROGRESS`, its PLAN cannot be edited. **No `SessionPlanOverride` is part of the product concept.** Execution differences are recorded as PLAN versus FACT.

The lock applies only to the started occurrence, not the entire program or all future occurrences.

```text
8 Sep   Workout A   IN_PROGRESS   locked
10 Sep  Workout B   SCHEDULED     editable
15 Sep  Workout A   SCHEDULED     editable
```

Backend enforcement is mandatory. A stale program-plan save after the client starts must fail with a domain conflict such as `PLAN_LOCKED` where applicable.

## Own workout semantics

`Своя тренировка` deliberately bypasses program prescription for the new session.

- the session has no source `program_day`;
- exercises may be added directly to the session;
- session exercises/sets may therefore have no source program exercise/set IDs;
- creating or editing the own workout does not mutate the client's assigned program;
- previous-performance context may still be shown where exercise history exists.

## Completion

Explicit Finish is optional. Initial default: auto-complete after **60 minutes** with no new workout result/activity. Timeout completion uses the last known workout activity as `completed_at` and records completion source.

```text
completion_source = EXPLICIT | TIMEOUT | MANUAL
```

Auto-completed FACT remains explicitly correctable by an authorized actor.

## Manual time and post-fact entry

Both client and coach may set actual `started_at` and `completed_at`. Technical persistence timestamps remain separate.

A post-fact workout may be entered as already completed without requiring a visible live `IN_PROGRESS` phase. This is a separate historical/manual-entry flow and does not weaken the explicit Start requirement for normal live execution.

## Accepted offline ambiguity

If a client trains without the app, Mezfit cannot know the workout physically began, so the coach may edit the future occurrence during that period. MVP accepts this. When the workout is later explicitly started or entered post-fact, Mezfit freezes the effective plan available to the server at session creation and does not reconstruct a historical plan to guess what the client physically saw.

## FACT ownership and audit

Both coach and client may create actual results for a shared session. Persist sufficient author/edit timestamps and user IDs. Historical FACT is immutable with respect to program edits but may be explicitly corrected.

## Synchronization

Backend is source of truth. MVP uses request/refresh synchronization rather than requiring WebSockets.
