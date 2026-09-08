# Gym Keeper Workout Editor and Lifecycle

## Scope

Static APK analysis of the core workout editing/execution path. This document separates directly observed evidence from inferred behavior and Mezfit product priority.

## Observed: workout composition

The APK contains dedicated UI/resources for:

- `dialog_edit_workout.xml`
- `fragment_day.xml`
- `fam_add_exercises.xml`
- `dialog_choose_exercises.xml`
- `dialog_choose_exercises_from_day.xml`
- `dialog_choose_exercises_from_workout.xml`
- `li_exercise_edit.xml`
- `dialog_workout_exercise_sets.xml`
- `dialog_edit_set.xml`
- `l_set_view.xml`

Relevant strings include:

- `Add Exercises`
- `Add exercises with one tap`
- `Copy exercises from another day`
- `Choose a day to copy exercises from`
- `Recent exercises`
- `This exercise is already in the workout. Add another one?`
- `Combine with another exercise`
- `Superset with the next`
- `Delete exercise`
- `Remove exercise`
- `REORDER EX [DB]`

### Inferred

A workout is an ordered list of exercises. Exercises can be inserted from the catalogue, copied from another day/workout, duplicated despite an existing occurrence after confirmation, removed/reordered, and combined into supersets.

### Mezfit priority

- Ordered exercises in coach program editor: **M**
- Search/add exercise: **M**
- Reorder/remove exercise: **M**
- Copy/reuse exercises between workouts: **S**
- Superset grouping: **S**
- One-tap/instant-add preference: **W for now**

## Observed: set editor

The APK has type-specific set input layouts:

- `l_edit_set_weight.xml`
- `l_edit_set_reps.xml`
- `l_edit_set_time.xml`
- `l_edit_set_distance.xml`

Observed tracking labels include:

- `Weight & Reps`
- `Time`
- `Time & Distance`
- `Time & Reps`
- `Time & Weight`

Observed set-related controls/strings include:

- `b_add_set`
- `Copy sets`
- `Copy corresponding set of previous workout`
- `Always copy the last set`
- `press_again_delete_set`
- `Set difficulties`
- `Sets completed`
- `Autostart after adding a set`

### Inferred

Set entry is tracking-type aware. Adding a set can participate in auto-fill/copy behavior and can trigger the rest timer. Set deletion has a confirmation/safety interaction. Gym Keeper treats set creation/editing as a frequent in-workout action rather than a separate planning-only operation.

### Mezfit priority

- Type-aware `PlannedSet` / `SetResult`: **M**
- Fast actual-set entry/editing: **M**
- Copy previous actual set as a convenience: **C**
- Complex auto-fill modes: **W for now**
- Difficulty buttons: **C**
- Rest timer autostart: **S**

## Observed: previous performance and auto workout time

Strings include:

- `Last time`
- `Previous`
- `Auto - uses values from the most recent performance of each exercise`
- `getWorkoutDateLast`
- `updateWorkoutDateLastIfNeeded`
- `Auto workout time`
- `Auto workout time. Calculates the duration based on the time of adding sets.`
- `Manual workout time`

### Inferred

Gym Keeper makes previous exercise performance available as an input/reference for the current workout. Its automatic workout-duration mode derives duration from set-addition timestamps/activity rather than requiring an explicit start/stop lifecycle in every case.

### Mezfit decision

Mezfit should not copy the ambiguous diary-style duration model. A coached session has an explicit lifecycle:

`WorkoutOccurrence -> start -> WorkoutSession(started_at) -> complete -> completed_at`

Previous performance remains first-class context, but it is returned by the backend independently from the coach plan.

### Mezfit priority

- Explicit start/complete session lifecycle: **M**
- Previous performance beside current plan: **M**
- Gym Keeper-style auto duration inferred from adding sets: **W**
- Manual duration override: **C**

## Observed: comments and workout metadata

Strings/resources include:

- `Add a comment to the workout`
- `dialog_edit_exercise_comment.xml`
- `auto_fill_option_exercise_comments`
- Realm accessors for `comment`, `date`, `durationMin`, `sets`, and `exercises`.

### Mezfit decision

Do not collapse all comments into one generic field. Preserve separate semantics for coach prescription/instruction and client execution notes; conversational feedback belongs to Telegram-linked feedback.

### Mezfit priority

- Coach instruction: **S**
- Client workout/exercise note: **S**
- Auto-copy comments: **W**

## Observed: completion/history signals

The APK contains:

- `b_done`
- `getCompleted`
- `Exercises completed`
- `Sets completed`
- `Workouts completed`
- exercise history/record layouts
- workout/date-last helpers

Static strings alone do not yet prove the exact internal state transition implementation for `completed`; this requires deeper code-level decompilation or runtime observation.

### Mezfit decision

Regardless of Gym Keeper internals, completion in Mezfit must be explicit and domain-safe. Completed sessions are historical fact and must not be rewritten by later program edits.

### Mezfit priority

- Complete workout action/state: **M**
- Completed set state: **M**
- Historical immutable session: **M**

## Product takeaway

The valuable part of Gym Keeper's editor is not its large collection of smart preferences. It is the low-friction editing loop:

1. select exercise;
2. see useful previous context;
3. add/edit sets quickly;
4. reorder/group exercises;
5. complete the workout;
6. retain history.

For Mezfit the same interaction must be split across two roles:

- **Coach** owns prescription and future program editing.
- **Client** owns actual execution/results.

The central invariant remains `plan != fact`; convenience features must never blur that boundary.
