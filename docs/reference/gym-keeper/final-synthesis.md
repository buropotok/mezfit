# Gym Keeper — Final synthesis for Mezfit

## Purpose

This document closes the static APK reference-analysis phase before Mezfit concept review and MVP freeze.

It consolidates what is useful to copy as a workflow idea, what must be redesigned for a coach-client/cloud product, and what should be consciously excluded.

## What Gym Keeper is optimized for

Gym Keeper is a local-first personal workout tracker. Its conceptual center is approximately:

```text
Journal / Diary
  -> Day
      -> Workout
          -> Exercise
              -> Set
```

Programs, previous results, copying, statistics, measurements, local backup, notebook, timers and utilities orbit that personal diary.

That architecture is coherent for a single-user local Android tracker, but it should not become Mezfit's architecture.

## What Mezfit is optimized for

Mezfit is a coach-client system where prescription and execution have different owners.

The product center should remain:

```text
CoachClient
  -> ProgramAssignment
      -> WorkoutDefinition
      -> Schedule
          -> WorkoutOccurrence
              -> WorkoutSession
```

with explicit separation between:

```text
PLAN
PlannedExercise
PlannedSet
coach instruction

FACT
ExerciseResult
SetResult
client note
```

and an immutable effective `plan_snapshot` once a session starts.

## High-value Gym Keeper ideas to preserve

### 1. Extremely low-friction set entry

A client should be able to execute a workout without navigating through configuration screens.

**Mezfit priority: M.**

### 2. Previous performance directly in context

`Last time` / `Previous` is one of the strongest reference ideas. It belongs both in client execution and coach prescription.

**Mezfit priority: M.**

### 3. Type-aware exercise tracking

Exercises can be weight/reps, time, distance/time, reps/time, weight/time, etc.

**Mezfit priority: M.**

### 4. Fast exercise catalogue search

Search, recent exercises, filters and favourites reduce coach editing friction.

**Mezfit priority: M for search; S for accelerators.**

### 5. Reuse/copy mechanics

Copy exercise, sets, workout/day and program structures rather than recreating them.

**Mezfit priority: S.**

### 6. Superset grouping

A real training-program structure rather than a cosmetic UI feature.

**Mezfit priority: S.**

### 7. Rest timer after a set

Useful during client execution, but not part of the domain core.

**Mezfit priority: S.**

### 8. History as an exercise-level tool

History is most valuable when visible at the decision point: choosing today's load or prescribing the next load.

**Mezfit priority: M for previous result; S for full history.**

### 9. Measurements and progress photos

Useful for remote coaching beyond strength logs.

**Mezfit priority: S/C.**

## Ideas that must be redesigned, not copied

### Diary -> CoachClient + Assignment + Schedule

A local journal is an ownership container. Mezfit already has ownership through user/coach/client relations.

### Dated workout -> Occurrence + Session

Do not combine scheduling and execution in one mutable object.

### Comment -> typed ownership

Split coach instruction, client note and Telegram conversation context.

### Local backup -> backend durability

Do not reproduce `.dbi`/Google Drive backup UX. Keep only migration import as a product concern.

### Timer foreground service -> timestamp-based timer

Browser/Mini App timer state should be reconstructible from time, not dependent on Android service lifecycle.

### Delete/replace exercise -> archive + snapshots

Historical sessions must remain renderable after catalogue changes.

## Features intentionally excluded for now

- bundled Gym Keeper programs
- multiple journals
- diary notebook
- medals/share cards
- Tabata
- complex autofill policies
- timer sound customization
- data-optimization UI
- local DB backup/restore UI
- Google Drive synchronization UI
- barbell inventory
- resistance-band inventory
- generic fitness calculators
- extensive theme/layout preferences

These are **W — Won't have for now** unless later product evidence changes the decision.

## Reference-derived client navigation direction

Gym Keeper gives useful evidence for the underlying data, but Mezfit should simplify navigation around the assigned work:

```text
Today      — current scheduled workout / active session
Program    — coach-assigned program
Calendar   — future and past occurrences
Progress   — measurements / trends
History    — completed sessions
```

`Today` should be the primary client entry point.

## Reference-derived coach navigation direction

Coach workflows should remain client-contextual:

```text
Clients
  -> Selected client
      -> Overview
      -> Program
      -> Calendar
      -> Progress
      -> History
```

Program editing should combine exercise search, client previous performance, prescription editing and structural reuse without forcing context switches.

## Static-analysis confidence

### High confidence

Directly supported by APK model/resource/string evidence:

- model names and many persisted fields
- exercise tracking types
- set metrics
- catalogue/search/favourites/custom editing concepts
- previous-result UI
- workout/day/program copy actions
- supersets
- timer modes/settings
- exercise history/records
- measurements/photos
- journal/program import/export
- local backup subsystem
- calendar/day navigation
- notebook/result/calculator auxiliary modules

### Medium confidence

Architectural behavior inferred from combinations of strings/fields/resources:

- exact ownership hierarchy inside Realm objects
- precise previous-workout selection algorithm
- exact program-to-diary materialization behavior
- detailed transactional behavior when editing existing dated workouts

These should be verified only if needed for migration compatibility.

### Requires a real export sample

- exact Gym Keeper Diary JSON/data schema
- exact Program export schema
- exact `.dbi` backup structure and versioning
- IDs/reference semantics needed for deterministic migration

## Conclusion

The APK has now provided enough evidence for product architecture and UX reference work. Further reverse engineering is unlikely to change Mezfit's core concept materially unless the goal becomes byte-compatible Gym Keeper migration.

The next project phase should be:

1. concept review;
2. resolve open product choices;
3. MVP freeze with strict MoSCoW;
4. dependency-ordered implementation plan;
5. architecture/database/API decisions driven by the frozen MVP.

No Gym Keeper feature should enter the MVP merely because it exists in the reference application.