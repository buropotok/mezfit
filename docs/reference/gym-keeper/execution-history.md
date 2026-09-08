# Gym Keeper — Workout execution, previous results, and history

## Scope

Static APK analysis of the workout execution path, set entry, previous-result behavior, workout completion, history, records, and interruption-related UX evidence.

## Observed execution UI

Resources and user-facing strings confirm an execution-oriented flow with:

- `dialog_workout_exercise_sets.xml`
- `dialog_edit_set.xml`
- `l_set_view.xml`
- `l_edit_set_weight.xml`
- `l_edit_set_reps.xml`
- `l_edit_set_time.xml`
- `l_edit_set_distance.xml`
- `l_set_diff.xml`
- `l_timer.xml`

Important strings include:

- `Last time`
- `Previous`
- `Add at least one exercise`
- `Add a comment to the workout`
- `Set count`
- `Sets completed`
- `Exercises completed`
- `Workouts completed`
- `Done`
- `Copy corresponding set of previous workout`
- `Always copy the last set`
- `Autostart after adding a set`
- `Auto workout time. Calculates the duration based on the time of adding sets.`
- `Manual workout time`
- `Workout duration`
- `Workout volume`
- `The existing workout will be overwritten. Continue?`

The set editor is type-aware. Confirmed exercise types include:

- `WEIGHT_REPS`
- `TIME`
- `TIME_DISTANCE`
- `TIME_REPS`
- `TIME_WEIGHT`

Weight modes include:

- `BODYWEIGHT`
- `SINGLE_WEIGHT`
- `DOUBLE_WEIGHT`
- `MAINTAIN_WEIGHT`

A set can therefore represent several fundamentally different measurements; it is not safe to model all results as `weight × reps`.

## Previous-result semantics

The APK explicitly exposes both `Last time` / `Previous` UI and an autofill option named `Copy corresponding set of previous workout`.

This strongly indicates that previous performance is resolved by exercise identity and relative set position, with a separate notion of the most recent related performance used by autofill.

The exact selection algorithm cannot be proven from strings alone, so this remains partially inferred.

### Mezfit decision

The backend should resolve previous performance deterministically and return it ready to render:

```text
previous
plan
session
```

The frontend should not query arbitrary history and decide what counts as previous.

For a planned set the execution UI can then render:

```text
Set | Previous | Plan | Today
1   | 82.5 x 8 | 85 x 8 | [input]
2   | 82.5 x 8 | 85 x 8 | [input]
3   | 80 x 10  | 85 x 8 | [input]
```

For non-weight/reps exercises the same contract must be type-aware.

## Completion and history

The APK has explicit history and records surfaces:

- `fragment_info_history.xml`
- `li_exercise_history.xml`
- `li_exercise_records.xml`
- `Exercise records`
- `Empty History`
- `History`
- `Records`

The existence of `The existing workout will be overwritten. Continue?` suggests Gym Keeper permits editing/replacing a dated workout record after it exists.

For Mezfit, completed history should be much stricter because coach prescription and client execution have separate ownership.

### Mezfit invariant

Normal program edits must never rewrite historical or already-started workouts.

```text
Program edit
  -> future occurrences resolve updated plan
  -> active/completed session snapshot unchanged
```

Only an explicit active-session override can change an in-progress prescription, and it must be auditable.

## Timer coupling

Gym Keeper can autostart the rest timer after adding a set and supports normal and Tabata timers.

For Mezfit:

- save `SetResult` first;
- then start rest countdown from the effective plan's `rest_seconds`;
- resume the session independently of whether the countdown survives UI closure;
- Tabata-specific workflow remains outside the initial scope.

## Workout duration

Gym Keeper supports both manual and automatically calculated workout duration.

Mezfit should avoid the heuristic `time between set additions` as authoritative duration. Prefer explicit session timestamps:

- `started_at`
- `completed_at`
- optional pause/active-time treatment later if needed.

Derived duration is then deterministic.

## Workout comments

Gym Keeper has workout, day, and exercise comments. Mezfit should split intent:

- coach prescription note: part of plan/snapshot;
- client execution note: part of fact;
- conversational feedback: Telegram-linked thread/reference.

A generic shared `comment` field would blur ownership.

## Interruption / resume

Static resources do not expose a distinct resume state label, but Gym Keeper is a local persistent tracker and stores workout/set data incrementally. Mezfit must explicitly support interruption because a Mini App can be closed at any time.

The session API should therefore make `in_progress` durable and idempotent:

- reopening Today resolves existing active session;
- already saved SetResults remain;
- completing a set is idempotent;
- completing the workout transitions once to completed.

## MoSCoW

- **Start/execute/complete assigned workout — M.** Core client workflow.
- **Persist actual set results separately from plan — M.** Core plan-vs-fact invariant.
- **Previous result next to plan — M.** High-value execution and coach prescription context.
- **Durable resume of active session — M.** Required for Telegram Mini App reliability.
- **Historical workout detail / plan-vs-fact — S.** Important coach/client review surface.
- **Rest timer tied to completed set — S.** Useful execution accelerator.
- **Derived exercise records/charts — C.** Secondary analytics.
- **Complex autofill policies — W.** Low-value complexity for a coach-prescribed system.
- **Manual workout-duration entry — W.** Session timestamps are sufficient for initial Mezfit.
- **Tabata workflow — W.** Outside core coaching flow.

## Decision

Gym Keeper confirms the value of immediate previous-performance context and extremely low-friction set entry. Mezfit should preserve those UX advantages while enforcing a stronger domain boundary between prescription and execution.