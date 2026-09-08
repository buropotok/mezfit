# Workout Lifecycle and Plan Locking

## Scope

This document defines when a workout becomes in progress, when its plan is frozen, how completion is inferred, and what coach/client edits are allowed.

These rules are product/domain invariants, not merely UI behavior.

## Entities

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

`WorkoutOccurrence` represents the planned dated/ordered workout. `WorkoutSession` represents known actual execution.

## State model

Core states:

```text
SCHEDULED
   │ first persisted actual result
   ▼
IN_PROGRESS
   │
   ├── explicit Finish
   │
   └── inactivity timeout
          ▼
      COMPLETED
```

Additional occurrence outcomes include `SKIPPED`, `CANCELLED`/equivalent, and rescheduling semantics defined separately.

## Start semantics

There is no required Start button.

The first persisted actual result is the authoritative server-known start event. The backend must atomically:

1. verify that the occurrence is startable;
2. create/resolve its `WorkoutSession`;
3. copy the current occurrence prescription into immutable `plan_snapshot`;
4. transition to `IN_PROGRESS`;
5. persist the first result;
6. set automatic `started_at` unless manually provided.

Both coach and client may trigger this by recording FACT.

## Plan lock

Once a specific occurrence is `IN_PROGRESS`, its PLAN cannot be edited.

No `SessionPlanOverride` is part of the current product concept.

If actual execution differs from prescription, preserve the difference as PLAN versus FACT:

```text
PLAN        FACT
85 × 8      85 × 8
85 × 8      90 × 8
85 × 8      90 × 7
```

The fact that the coach chose 90 kg during an in-person workout does not retroactively alter that session's PLAN and does not automatically change future prescription.

### Lock granularity

The lock applies only to the started `WorkoutOccurrence`, not the entire program or every occurrence based on the same workout definition.

```text
8 Sep   Workout A   IN_PROGRESS   locked
10 Sep  Workout B   SCHEDULED     editable
15 Sep  Workout A   SCHEDULED     editable
```

This allows the coach to work on future prescriptions while the client is training.

### Concurrency

Backend enforcement is mandatory.

Example:

```text
19:00 coach opens editor
19:01 client records first set → occurrence becomes IN_PROGRESS
19:02 coach saves stale editor
```

The save must fail with a domain conflict such as `PLAN_LOCKED`; the UI then refreshes and explains that the client has started the workout.

## Completion semantics

Explicit Finish is optional.

Initial default: auto-complete after **60 minutes** with no new recorded workout result. The exact timeout is a product parameter and should be validated in real use.

For timeout completion:

- completion reason is `TIMEOUT`;
- `completed_at` should reflect the last known workout activity/result time, not the later timeout-processing timestamp;
- auto-completed FACT remains correctable through explicit authorized edits.

Recommended completion provenance:

```text
completion_source = EXPLICIT | TIMEOUT | MANUAL
```

## Manual time and post-fact entry

Both client and coach may explicitly set actual `started_at` and `completed_at`.

This is required because workouts may be entered after the fact from paper notes or memory.

Technical persistence timestamps remain separate:

```text
started_at    # actual workout time
completed_at  # actual workout time
created_at    # database record creation
updated_at    # database mutation
```

A post-fact workout may be entered as an already completed session without requiring a visible live `IN_PROGRESS` phase.

## Accepted offline ambiguity

If a client trains without the app, Mezfit cannot know that the physical workout has begun. Therefore the coach may edit the future occurrence during that period.

MVP explicitly accepts this ambiguity.

When results are eventually entered, Mezfit freezes the plan version available on the server at first persistence. It does not reconstruct a historical plan from `ProgramChange` in an attempt to guess what the client saw offline.

## FACT ownership and audit

Both coach and client may create actual results for a client's shared session.

Persist enough audit information to determine who created or changed a result, for example:

```text
created_by_user_id
updated_by_user_id
created_at
updated_at
```

Historical FACT is immutable with respect to program edits, but explicit authorized correction of FACT is allowed.

## Synchronization

Backend is the source of truth. MVP uses request/refresh synchronization rather than requiring WebSockets.

A role should receive current state on app load, foreground/resume, relevant screen navigation, manual refresh, and after mutations.

## Mezfit priorities

- shared `WorkoutSession`: **M**
- first-result automatic start: **M**
- occurrence-level plan lock: **M**
- immutable plan snapshot: **M**
- coach recording FACT: **M**
- manual start/end time: **M**
- post-fact workout entry: **M**
- inactivity auto-completion: **M**
- optional explicit Finish: **S** as a UX convenience
- realtime/WebSocket synchronization: **W** for MVP
- in-progress plan override: **W** under current product rules
