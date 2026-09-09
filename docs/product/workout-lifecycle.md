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

## State model

```text
SCHEDULED
   │ first persisted actual result
   ▼
IN_PROGRESS
   │
   ├── explicit Finish
   └── inactivity timeout
          ▼
      COMPLETED
```

Additional occurrence outcomes include skipped/cancelled/rescheduled semantics.

## Start semantics

There is no required Start button. The first persisted actual result is the authoritative server-known start event. The backend atomically:

1. verifies the occurrence is startable;
2. creates/resolves `WorkoutSession`;
3. copies the current effective prescription into immutable `plan_snapshot`;
4. transitions to `IN_PROGRESS`;
5. persists the first result;
6. sets automatic `started_at` unless manually provided.

Both coach and client may trigger this.

## Plan lock

Once a specific occurrence is `IN_PROGRESS`, its PLAN cannot be edited. **No `SessionPlanOverride` is part of the product concept.** Execution differences are recorded as PLAN versus FACT.

The lock applies only to the started occurrence, not the entire program or all future occurrences.

```text
8 Sep   Workout A   IN_PROGRESS   locked
10 Sep  Workout B   SCHEDULED     editable
15 Sep  Workout A   SCHEDULED     editable
```

Backend enforcement is mandatory. A stale save after the client starts must fail with a domain conflict such as `PLAN_LOCKED`.

## Completion

Explicit Finish is optional. Initial default: auto-complete after **60 minutes** with no new workout result/activity. Timeout completion uses the last known workout activity as `completed_at` and records completion source.

```text
completion_source = EXPLICIT | TIMEOUT | MANUAL
```

Auto-completed FACT remains explicitly correctable by an authorized actor.

## Manual time and post-fact entry

Both client and coach may set actual `started_at` and `completed_at`. Technical persistence timestamps remain separate.

A post-fact workout may be entered as already completed without requiring a visible live `IN_PROGRESS` phase.

## Accepted offline ambiguity

If a client trains without the app, Mezfit cannot know the workout physically began, so the coach may edit the future occurrence during that period. MVP accepts this. When results are first persisted, Mezfit freezes the plan available on the server at that moment and does not reconstruct a historical plan to guess what the client saw.

## FACT ownership and audit

Both coach and client may create actual results for a shared session. Persist sufficient author/edit timestamps and user IDs. Historical FACT is immutable with respect to program edits but may be explicitly corrected.

## Synchronization

Backend is source of truth. MVP uses request/refresh synchronization rather than requiring WebSockets.
