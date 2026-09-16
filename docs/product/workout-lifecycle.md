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

`WorkoutOccurrence` represents an expected/scheduled workout. `WorkoutSession` represents the persisted execution context, beginning with a minimal draft created when the user enters the workout launch flow.

A workout may also be started outside the program as `Своя тренировка`; such a session has no source program day/occurrence.

## State model

Normal live workout:

```text
NO SESSION
   │ POST initialize
   ▼
DRAFT
   │ user chooses Program / Own and confirms Start
   ▼
IN_PROGRESS
   │
   ├── explicit Finish
   └── inactivity timeout
          ▼
      COMPLETED
```

`DRAFT` is intentionally minimal. It establishes a stable `workout_session.id` before the workout type is chosen, but it contains no session exercises, PLAN, PREVIOUS, or FACT. Program/phase/day returned during initialization are launch metadata only; source program provenance is not persisted on the draft and is written to `workout_session` only by a successful program Start.

Additional occurrence outcomes include skipped/cancelled/rescheduled semantics.

## Global Start / Continue entry point

Mezfit exposes one global personal workout FAB through the application/navigation shell. It is available to any authenticated app user in both Client and Coach contexts; the active UI role does not change access to the user's own workout.

- without an active session: `Начать тренировку`;
- with an active session: `Продолжить тренировку`;
- while already viewing the current active workout: the FAB is hidden.

The global launcher is the canonical entry point. Individual screens must not own competing workout-start state.

If the workout owner has multiple active programs, the external launch workflow must show that ambiguity and let the user choose a program. `WorkoutSessionScreen` receives an already resolved program context and does not decide between multiple active programs itself.

## Initialize semantics

Opening the workout flow immediately opens `WorkoutSessionScreen`, which owns the first workout-domain backend request. The screen shows a blocking loader while `POST /api/workout-sessions/initialize` runs.

The backend establishes the workout owner from trusted Telegram authentication. Workout routes require an authenticated app user, but do not require a `client` or `coach` role; the session is always scoped to the server-resolved authenticated user ID. Active UI role and arbitrary frontend `user_id` values are not accepted as workout identity.

Initialization is idempotent:

1. if an active session already exists, return its current canonical projection for Continue;
2. if a draft already exists, return/reuse that draft;
3. otherwise create one minimal draft session and return its generated `sessionId`.

For a resolved program, initialization also returns the current program/phase and day-selection metadata needed by the launch UI. The default day is the trainer-scheduled day when scheduling explicitly resolves one; otherwise it is the next unfinished active day in the phase. Trainer scheduling is an override of simple sequence, not a derivation from the last completed day.

The initialize response deliberately does **not** materialize exercises and does not return PLAN, PREVIOUS, or FACT. This keeps `Своя тренировка` cheap and ensures program data is read at the actual Start boundary.

## Start semantics

Live workout start is explicit. Recording the first FACT is not the start event.

While the session is `DRAFT`:

1. an unambiguous scheduled/default day may be preselected;
2. the user may choose `Сменить день` to select another active day from the resolved phase;
3. the user may choose `Своя тренировка` to start outside the program.

The second request is the Start boundary.

For a program workout, `POST /api/workout-sessions/:id/start` receives the selected `programDayId`. The backend fresh-reads the current program prescription at that moment, validates that the selected day still belongs to one of the authenticated user's active programs and its active phase, then atomically:

1. records source program provenance on the existing draft session;
2. copies/materializes active `program_exercise` rows into `session_exercise`;
3. copies the latest active `program_set` values into `session_set.planned_*`;
4. resolves PREVIOUS for each set from the same exercise and set position in the latest relevant completed workout;
5. transitions the session to `IN_PROGRESS` and sets `started_at`;
6. returns the full canonical session projection with PLAN + PREVIOUS and FACT initially absent.

For `Своя тренировка`, Start only transitions the draft into an active session with no source program/phase/day and no pre-created children. PLAN and PREVIOUS are not requested or returned for this initialization path.

No FACT is required to create or start the session.

## Session PLAN ownership

Before Start, the program is the editable prescription source.

At program Start, the backend reads the current prescription and freezes it into session storage. After Start, the active workout reads PLAN only from the frozen/materialized session data. The mutable program is no longer the source of PLAN for that session.

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

- the active session has no source program, phase, or `program_day`;
- no PLAN or PREVIOUS payload is required to initialize the own-workout screen;
- exercises may be added directly to the session;
- session exercises/sets may therefore have no source program exercise/set IDs;
- creating or editing the own workout does not mutate the user's assigned program.

Historical context may be introduced later for a specific exercise after the user adds it, but it is not part of the `Своя тренировка` Start response.

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

If a client trains without the app, Mezfit cannot know the workout physically began, so the coach may edit the future occurrence during that period. MVP accepts this. When the workout is later explicitly started or entered post-fact, Mezfit freezes the effective plan available to the server at Start and does not reconstruct a historical plan to guess what the client physically saw.

## FACT ownership and audit

Both coach and client may create actual results for a shared session. Persist sufficient author/edit timestamps and user IDs. Historical FACT is immutable with respect to program edits but may be explicitly corrected.

## Synchronization

Backend is source of truth. MVP uses request/refresh synchronization rather than requiring WebSockets.
