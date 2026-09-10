# Gym Keeper exercise catalogue parity — Issue #58

Status: implementation evidence for the global Mezfit `Упражнения` module.

## APK recheck

The supplied `com.kg.app.sportdiary_615_rs.apk` was rechecked before implementation. The exercise subsystem is not a single list screen: the APK contains dedicated catalogue/selection, edit and info resources including `dialog_choose_exercises.xml`, `dialog_choose_exercises_from_day.xml`, `dialog_choose_exercises_from_workout.xml`, `dialog_edit_exercise.xml`, `activity_exercise_info.xml`, `li_exercise_small.xml`, `li_exercise_edit.xml`, `l_exercise_image.xml` and `fam_add_exercises.xml`.

The APK also contains the action assets used by this implementation: `ic_exercise`, `ic_search`, `ic_filter`, `ic_sort_abc`, `ic_add`, `ic_edit`, `ic_delete`, `ic_favourites` and `ic_favourites_empty`.

DEX evidence reconfirmed catalogue behaviours already recorded in `exercise-system.md`: name search, filter/type selection, alphabetical/own-order sorting identifiers, favourites, create/edit/delete, tracking types, muscle-group classification and equipment classification.

## Bundled catalogue extraction

`classes2.dex` contains **334 unique exercise GIF references** under `/img/gifs/180/`. The deterministic extraction tool at `tools/extract-gym-keeper-catalog.mjs` parses those references directly from the DEX byte stream, derives reference exercise name/category/equipment seed metadata and emits SQL.

The generated catalogue is split across migrations `0007_gym_keeper_exercise_seed_01.sql` through `0013_gym_keeper_exercise_seed_07.sql` to keep migration files reviewable. Duplicate canonical names are de-duplicated by the extractor.

Each seeded definition records:

- `reference_source = gym_keeper_apk`;
- exact APK-derived GIF filename as `reference_key`;
- deterministic `reference_order`.

The reference key is deliberately persisted now so #34 can attach the approved image/GIF payload to the same definition without fuzzy name matching.

## Implemented catalogue flow

The global coach drawer destination `Упражнения` opens a real catalogue rather than a placeholder. It is independent of selected-client context and exposes GLOBAL definitions plus coach-owned custom definitions. CLIENT-scoped definitions stay inside client context.

The global catalogue implements the reference interactions that have a clean standalone meaning in Mezfit:

- compact exercise list;
- search by name;
- category filter;
- tracking-type filter;
- alphabetical sorting and deterministic reference-order sorting;
- coach-specific favourites;
- create coach-owned custom exercise;
- exercise info/detail surface;
- edit/archive coach-owned definitions;
- read-only protection for bundled/global definitions.

Create/edit retains the reference field structure: media slot, name, description, tracking type, category and equipment. In the global catalogue the Mezfit scope is fixed to `Всем моим клиентам`; client-only scope remains in the selected-client flow delivered by #33/#35.

## Domain differences kept intentionally

Gym Keeper's Realm representation is not copied literally. Mezfit keeps `ExerciseDefinition` separate from future prescription and FACT state. Global definitions are immutable to an individual coach; coach-created definitions can be edited and archived. Archive is used instead of destructive deletion so later workout/history work can preserve references (#36).

`isFavourite` is not stored on the shared global definition. Favourites are persisted in `coach_exercise_favourite`, because favourite state belongs to the coach viewing the catalogue.

Gym Keeper's separator/highlight pseudo-exercise representation is not imported into `ExerciseDefinition`; those are workout-editor presentation concepts and remain outside the catalogue domain.

Manual custom catalogue ordering is not introduced in #58. The APK exposes an `own_order` sorting identifier, but the first global Mezfit parity slice provides alphabetical order plus the deterministic bundled/reference order. If hands-on APK validation confirms user-managed drag ordering as a required catalogue interaction rather than a workout-editor concern, it should be added as a focused follow-up rather than overloading shared `ExerciseDefinition` with per-coach position state.

## Telegram / Variant 4 adaptation

The information architecture and actions follow Gym Keeper. The surrounding global app bar, safe-area behaviour, colours and surface tokens follow Mezfit's Telegram platform policy and Variant 4 theme system. APK PNG actions are rendered as alpha masks so the same approved icon artwork participates in all five Mezfit themes without temporary Unicode/emoji glyphs.

## Media boundary

#58 keeps a stable media slot but does not ship the large exercise GIF/image library inside the React bundle. Extraction/copy to R2 and runtime media delivery are owned by #34. The `reference_key` mapping added here is the deterministic join point for that work.
