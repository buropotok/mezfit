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

### Workout initialization, start and snapshot

Normal live workout execution has two explicit persistence boundaries. Entering the launch flow initializes a minimal `WorkoutSession` with status `draft` and a stable session ID. The draft has no materialized exercises, PLAN, PREVIOUS or FACT.

The second boundary is Start. For a program-based workout, Start fresh-reads and freezes/materializes the selected workout prescription into session-owned PLAN data, resolves PREVIOUS for the child set projection, and marks the session/occurrence `IN_PROGRESS`. From that point the session reads PLAN from its frozen/materialized session data rather than from the mutable program.

For `Своя тренировка`, Start promotes the draft to `IN_PROGRESS` without a source program day, without program PLAN/PREVIOUS payload, and without pre-created exercise children.

The first persisted actual result is not the start event.

### No active-session plan override

An `IN_PROGRESS` occurrence has a locked PLAN. There is no `SessionPlanOverride` in the current product model. A coach may record FACT that differs from PLAN during an in-person session, but that difference remains visible rather than rewriting the prescription.

The lock is occurrence-scoped. Other future occurrences remain editable.

### Program editing

The current assigned program remains mutable for practical coach work between sessions. `ProgramChange` provides auditability; full immutable program versions are not required for every small edit. Program edits never rewrite started/completed session snapshots.

### Scheduling and execution are separate

`WorkoutOccurrence` represents that a workout is expected/scheduled. `WorkoutSession` represents persisted execution context. Workout sessions are never pre-created for future calendar dates; a draft is created only when the client actually enters the workout launch flow.

A scheduled workout selects the default Start context but is not an irreversible choice: while the session remains `draft`, the client may choose another day from the resolved current phase or start `Своя тренировка`.

If multiple programs are active for the client, the outer launch workflow must resolve that ambiguity explicitly with the user before the session module receives a program context. The workout session component itself does not silently choose an active program.

Candidate scheduling policies:

- `WEEKDAY_FIXED`
- `SEQUENTIAL`

### Actual versus technical time

`started_at` / `completed_at` represent actual workout time and may be manually corrected or entered post-fact. `created_at` / `updated_at` are technical persistence timestamps and must remain distinct. A draft session has `started_at = NULL` until Start.

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
