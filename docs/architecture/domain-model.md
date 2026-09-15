# Mezfit Domain Model

## Core model

```text
User
├── CoachProfile
└── ClientProfile

CoachClient
└── ProgramAssignment
    ├── WorkoutDefinition
    │   └── PlannedExercise
    │       └── PlannedSet
    ├── Schedule
    └── ProgramChange

WorkoutOccurrence
└── WorkoutSession
    ├── plan_snapshot
    ├── ExerciseResult
    │   └── SetResult
    └── FeedbackThread
        └── TelegramMessageReference

ExerciseDefinition
├── GLOBAL
├── COACH
└── CLIENT
```

A `WorkoutSession` may originate from a scheduled/program workout or from `Своя тренировка`. An own workout has no source program day/occurrence and must not mutate the assigned program.

## Fundamental invariants

### Plan versus fact

Planned workout data and actual workout results are different entities. A recorded result never mutates the planned set that produced it.

### Workout start and snapshot

Normal live workout execution starts explicitly. Final Start confirmation creates the `WorkoutSession`; the first persisted actual result is not the start event.

For a program-based workout, Start freezes/materializes the selected workout prescription into session-owned PLAN data and marks the session/occurrence `IN_PROGRESS`. From that point the session reads PLAN from its frozen/materialized session data rather than from the mutable program.

For `Своя тренировка`, Start creates an `IN_PROGRESS` session without a source program day and without program PLAN.

Opening the workout launcher, preselecting a scheduled day or choosing a different day must not create an empty session before final Start confirmation.

### No active-session plan override

An `IN_PROGRESS` occurrence has a locked PLAN. There is no `SessionPlanOverride` in the current product model. A coach may record FACT that differs from PLAN during an in-person session, but that difference remains visible rather than rewriting the prescription.

The lock is occurrence-scoped. Other future occurrences remain editable.

### Program editing

The current assigned program remains mutable for practical coach work between sessions. `ProgramChange` provides auditability; full immutable program versions are not required for every small edit. Program edits never rewrite started/completed session snapshots.

### Scheduling and execution are separate

`WorkoutOccurrence` represents that a workout is expected/scheduled. `WorkoutSession` represents known actual execution. Empty sessions are not pre-created months into the future.

A scheduled workout selects the default Start context but is not an irreversible choice: before Start the client may choose another day from the current phase or start `Своя тренировка`.

Candidate scheduling policies:

- `WEEKDAY_FIXED`
- `SEQUENTIAL`

### Actual versus technical time

`started_at` / `completed_at` represent actual workout time and may be manually corrected or entered post-fact. `created_at` / `updated_at` are technical persistence timestamps and must remain distinct.

### Shared FACT ownership

Coach and client may record results into the same `WorkoutSession`. Persist actor/audit metadata on FACT mutations. Explicit historical correction is allowed; program edits are never a historical-correction mechanism.

### Exercise scopes

Exercise definitions may be:

- `GLOBAL` — common catalogue;
- `COACH` — custom exercise available across a coach's clients;
- `CLIENT` — custom exercise scoped to a specific client.

Definitions are archived rather than destructively deleting data required by history. A workout snapshot preserves enough exercise metadata to render historical sessions even if a definition changes later.

### Client-added exercise

A client may optionally add an exercise during a workout without mutating the coach's program. Actual exercise results should identify their source, for example `COACH_PLAN` or `CLIENT_ADDED`.

### Exercise groups

Use a group model rather than a single superset boolean so the domain can extend from normal exercises to supersets and later circuits/trisets.

## Client-contextual coach workflow

Coach-side program editing always operates in the context of a selected client. Exercise selection should therefore be able to return global/coach/client catalogue matches, exercises historically used by that client, previous actual performance, and current future prescription context.

The backend should return Previous / Plan / Fact projections ready for rendering rather than requiring the frontend to reconstruct previous results from arbitrary history queries.
