# Gym Keeper Reference Analysis

## Scope

Gym Keeper Android package `com.kg.app.sportdiary` is being analyzed as a functional and UX reference for Mezfit client workout mechanics and selected coach-side editing workflows.

This document records observed reference behavior. It does **not** define Mezfit requirements by itself.

## APK observations

The analyzed APK is a native Android application using Kotlin/Java and AndroidX. Realm is used for local persistence. Glide is present and is used with exercise GIF media.

Named domain models visible in the package include:

- `Band`
- `BarbellPart`
- `Data`
- `Day`
- `Diary`
- `Exercise`
- `Measure`
- `MeasureRecord`
- `MuscleGroup`
- `Program`
- `Set`
- `Settings`
- `TranslatableString`
- `Workout`

Important UI/resources include exercise editing/selection, workout/day editing, exercise history and records, measurements, statistics, timer options, set editors, and program views.

## Observed capabilities

### Exercise and set tracking

Realm accessors and resources indicate support for fields/concepts including:

- weight
- repetitions
- time
- distance
- working weight
- comments
- difficulty
- muscle groups
- exercise type/equipment
- favorite/highlight/separator flags
- supersets
- exercise media URI

Observed exercise/result modes include combinations such as weight + repetitions, time, time + distance, time + repetitions, and time + weight. Statistics/record logic includes maxima and totals for weight, repetitions, distance, and time.

### Difficulty / effort

Observed labels include none, warm-up, easy, normal, and hard.

### Supersets

The application explicitly supports supersets and a “superset with the next” workflow.

### Timer

The application supports automatic timer start around set entry/completion, normal rest timing, vibration/sounds, and a Tabata mode. Mezfit should preserve the useful rest-timer workflow but does not currently require the full Tabata subsystem for MVP.

### History and records

Exercise history, completed workout lookup, last workout date, records, statistics, and charts are present.

### Exercise catalogue/media

The APK contains hundreds of exercise GIF URLs and muscle-group assets. These establish the reference interaction pattern but must not be treated as production assets for Mezfit without appropriate rights. Mezfit should use its own/licensed media or coach-provided media.

### Program catalogue

Gym Keeper contains built-in programs. These are explicitly excluded from Mezfit. Mezfit's client program is coach-assigned.

## Reference-to-product boundary

Useful mechanics to retain or adapt include:

- fast set entry;
- previous result visibility;
- rest timer auto-start;
- exercise history and records;
- supersets;
- exercise search/create/edit workflows;
- copying exercises/sets/workouts where useful for coaches;
- multiple result/tracking types.

Mezfit adds a coach/client shared-state model, explicit plan-vs-fact semantics, immutable workout snapshots, client-scoped program editing, and Telegram-native feedback/communication.
