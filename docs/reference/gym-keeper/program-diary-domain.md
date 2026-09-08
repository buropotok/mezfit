# Gym Keeper — Program / Diary domain

## Scope

Static APK analysis of the relationships around `Diary`, `Program`, `Day`, `Workout`, `Exercise`, and `Set`. This is reference documentation only; it is not a Mezfit persistence specification.

## Observed

The APK exposes Realm-backed model concepts named:

- `Diary`
- `Program`
- `Day`
- `Workout`
- `Exercise`
- `Set`

Relevant persisted field names visible in Realm accessors include:

- `diaries`
- `currentDiaryId`
- `programs`
- `lastProgramId`
- `days`
- `epochDay`
- `workouts`
- `exercises`
- `sets`
- `comment`
- `notebook`
- `durationMin`
- `difficultyId`
- `exerciseTypeId`
- `exerciseEquipmentId`
- `targetMusclesIds`
- `supersetExercises`
- `weight`, `reps`, `timeSeconds`, `distance`
- `weightDelta`, `distanceDelta`, `timerDelta`

UI/resources confirm separate management flows for journals/diaries, programs, workouts, exercises and sets:

- `dialog_edit_diary.xml`
- `dialog_edit_program.xml`
- `dialog_edit_workout.xml`
- `dialog_edit_set.xml`
- `dialog_view_day.xml`
- `fragment_day.xml`
- `li_diary.xml`
- `li_program.xml`
- `li_workout.xml`

User-facing actions include:

- New / Edit / Delete journal
- New / Edit / Delete program
- New / Edit / Delete routine/workout
- Add exercises
- Copy exercises from another day
- From program
- Move day / Delete day
- Separate workouts within a day
- Duplicate
- Copy sets

The application also has distinct import/export actions for journals and programs:

- `Export journal`
- `Export program`
- `Import journal`
- `Import program`
- `importProgramOrDiary`

## Inferred structure

The static evidence is consistent with a local-first hierarchy approximately like:

```text
Diary
├── days
├── programs
├── notebook
└── current/default state

Day
├── epochDay
├── comment
└── workouts

Workout
├── exercises
└── durationMin

Exercise
├── exercise definition metadata
├── sets
├── difficulty / comments
└── superset links

Set
├── weight
├── reps
├── time
├── distance
└── delta/autofill fields
```

`Program` appears to act as reusable workout structure that can feed/copy workout content into a journal/day. The APK also contains many bundled programs, but their presence is not relevant to Mezfit product scope.

This model combines several concerns that Mezfit intentionally separates: reusable prescription, calendar placement, and performed workout history.

## Mezfit translation

Gym Keeper's local `Diary` should **not** become a Mezfit aggregate.

The canonical Mezfit separation remains:

```text
CoachClient
  -> ProgramAssignment
      -> WorkoutDefinition
      -> Schedule
          -> WorkoutOccurrence
              -> WorkoutSession
```

Key distinction:

- `WorkoutDefinition` = reusable prescription / plan.
- `WorkoutOccurrence` = one planned appearance on a date.
- `WorkoutSession` = actual execution, created when started.
- `plan_snapshot` = immutable effective prescription frozen for the session.

This avoids a core ambiguity in diary-style models: whether a dated workout object is simultaneously the plan and the result.

## Reuse semantics

Gym Keeper strongly confirms the value of copying/reusing workout structures. Mezfit should keep reuse as an explicit coach workflow rather than as shared mutable objects.

When copying a workout/day/program:

- exercise definitions may remain references;
- prescription data must be copied;
- the destination must be independently editable;
- copying must not create mutable linkage between two clients' plans.

This is covered by the coach copy/reuse backlog item.

## MoSCoW

- **Program assigned by coach — M.** Core prescription source.
- **Workout/day structure inside a program — M.** Required to express training plans.
- **Independent plan vs occurrence vs session — M.** Core Mezfit invariant.
- **Copy/duplicate program/workout/exercise prescription — S.** High leverage for coaches managing multiple clients.
- **Multiple local journals / current journal — W.** Replaced by coach-client relationships and backend ownership.
- **Bundled pre-built Gym Keeper programs — W.** Explicitly excluded.
- **Diary notebook — W.** Better handled by scoped notes and Telegram feedback.

## Decision

Use Gym Keeper as evidence that coaches need fast structural reuse, but do not mirror its local journal hierarchy. Mezfit should preserve the already-decided assignment/schedule/occurrence/session separation.