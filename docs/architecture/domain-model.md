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
    ├── SessionPlanOverride
    └── FeedbackThread
        └── TelegramMessageReference

ExerciseDefinition
├── GLOBAL
├── COACH
└── CLIENT
```

## Fundamental invariants

### Plan versus fact

Planned workout data and actual workout results are different entities. A client's entered result must never mutate the coach's planned set.

### Workout snapshot

When a workout starts, Mezfit creates an immutable `plan_snapshot`. Subsequent edits to the client's program must not change the started or historical workout.

### Active-session override

If a coach intentionally changes a workout that is already in progress, this is an explicit `SessionPlanOverride`, distinct from editing the future program. An active-session override does not necessarily change future workouts.

### Program editing

The current assigned program may remain mutable for practical coach editing. `ProgramChange` provides auditability; a complete immutable program version is not required for every small edit.

### Scheduling and execution are separate

`WorkoutOccurrence` represents that a workout is expected/scheduled. `WorkoutSession` represents actual execution. Empty sessions should not be pre-created months into the future.

Candidate scheduling policies:

- `WEEKDAY_FIXED`
- `SEQUENTIAL`

### Exercise scopes

Exercise definitions may be:

- `GLOBAL` — common catalogue;
- `COACH` — custom exercise available across a coach's clients;
- `CLIENT` — custom exercise scoped to a specific client.

A workout snapshot must preserve enough exercise metadata to render historical sessions correctly even if the exercise definition changes later.

### Client-added exercise

A client may optionally add an exercise during a workout without mutating the coach's program. Actual exercise results should identify their source, for example:

- `COACH_PLAN`
- `CLIENT_ADDED`

### Exercise groups

Use a group model rather than a simple superset boolean so the domain can support:

- normal exercises;
- supersets;
- circuits/trisets later.

Candidate fields: `exercise_group_id`, `group_type`.

## Client-contextual coach workflow

Coach-side program editing always operates in the context of a selected client. Exercise selection should therefore be able to return:

- global/coach/client catalogue matches;
- exercises recently used by this client;
- this client's history for the selected exercise;
- previous actual loads/repetitions;
- records/progression useful for assigning the next load.

The backend should return previous/plan/session data ready for rendering rather than requiring the frontend to reconstruct “previous result” from arbitrary history queries.
