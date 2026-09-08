# Gym Keeper reference — exercise system

This document records static APK findings about Gym Keeper's exercise catalogue and exercise-definition subsystem. It is reference evidence, not a Mezfit product specification.

## Evidence boundary

- **Observed** — directly present in APK DEX strings, Realm accessors, layouts or packaged resources.
- **Inferred** — behavior/schema reconstructed from several observed signals.
- **Decision** — proposed Mezfit behavior; belongs conceptually to the product architecture and is called out explicitly.

## Catalogue and exercise-definition model

### Observed

Gym Keeper has a persistent `com.kg.app.sportdiary.db.model.Exercise` Realm model and dedicated exercise UI/resources including:

- `activity_exercise_info.xml`
- `dialog_choose_exercises.xml`
- `dialog_choose_exercises_from_day.xml`
- `dialog_choose_exercises_from_workout.xml`
- `dialog_edit_exercise.xml`
- `dialog_edit_exercise_comment.xml`
- `li_exercise_edit.xml`
- `li_exercise_small.xml`
- `li_exercise_history.xml`
- `li_exercise_records.xml`
- `l_exercise_image.xml`
- `fam_add_exercises.xml`

Exercise actions/strings include:

- `exercise_create`
- `exercise_edit`
- `exercise_delete`
- `exercise_delete_warning`
- `exercise_remove`
- `exercise_added`

The exercise model exposes or references fields/concepts including:

- `exerciseTypeId`
- `exerciseEquipmentId`
- `muscleGroup`
- `targetMusclesIds`
- `imgUriStr`
- `isFavourite`
- `isSeparator`
- `isHighlighted`
- `supersetExercises`

### Inferred

Gym Keeper treats an exercise as a reusable definition with classification/media metadata, while workout/day structures reference or copy that definition into the workout editing flow. Separators/highlighting are presentation/editor concepts mixed into the model.

### Mezfit priority: M

A reusable exercise catalogue is required by the coach program editor. Mezfit should not copy Gym Keeper's model literally; catalogue definition, prescription and actual result must remain separate concepts.

## Tracking types

### Observed

DEX contains `ExerciseType` switching plus:

- `WEIGHT_REPS`
- `TIME`
- `TIME_DISTANCE`
- `TIME_REPS`
- `TIME_WEIGHT`

Resource/string identifiers confirm:

- `type_weight_reps`
- `type_time_distance`
- `type_time_reps`
- `type_time_weight`

The stats subsystem also varies defaults by exercise type.

### Decision

Mezfit's domain must not assume every exercise is `kg × reps`. `ExerciseDefinition.tracking_type` should drive both prescription fields and result-entry UI.

Initial canonical capability should cover at least:

- `WEIGHT_REPS`
- `REPS`
- `DURATION`
- `DISTANCE_TIME`
- `REPS_TIME`
- `WEIGHT_TIME`

Exact MVP exposure can be narrower than the persistence contract.

### Mezfit priority: M

Type-aware result capture is core data integrity. Less-common types may be hidden initially, but the schema/API should not require a destructive redesign later.

## Equipment classification

### Observed

Gym Keeper contains `exerciseEquipmentId`, `getExerciseEquipment`, `setExerciseEquipment`, `dialog_edit_equipment.xml`, and equipment identifiers:

- `equipment_bodyweight`
- `equipment_barbell`
- `equipment_single_weight`
- `equipment_double_weight`
- `equipment_machine_cable`
- `equipment_machine_other`
- `equipment_other`

### Inferred

Equipment is exercise metadata used for classification/editing rather than workout-result state.

### Mezfit priority: C

Useful for catalogue filtering and exercise discovery, but it does not block the core coach → program → client execution flow. Keep a field/taxonomy available without making sophisticated equipment filtering an MVP dependency.

## Muscle groups and target muscles

### Observed

Gym Keeper has a persistent `MuscleGroup` model and dedicated editing UI:

- `dialog_edit_muscle_group.xml`
- `li_muscle_group.xml`
- `menu_exercise_muscle_group_add.xml`
- `muscle_group_create`
- `muscle_group_edit`
- `muscle_group_delete`
- `muscle_group_delete_warning`
- `muscle_groups_all`
- `spinner_muscle_group`
- `spinner_muscle_subgroup`
- `target_muscles`
- `targetMusclesIds`

Packaged muscle/category imagery includes arm, back, biceps, calf, cardio, chest, core, forearm, full body, glutes, leg, neck, shoulders, triceps, warmup and activity/equipment-like icons such as run/swim/band/ball/bicycle/box.

### Inferred

Gym Keeper supports a primary muscle group plus additional target-muscle classification, and even allows user-managed muscle groups.

### Decision

For Mezfit, a stable global muscle-group taxonomy is preferable initially. Coach-created arbitrary muscle taxonomies add administration cost with little benefit. A custom exercise can still choose a global group and optionally target muscles.

### Mezfit priority

- Primary muscle group metadata: **S** — valuable for catalogue discovery and program editing.
- Target-muscle detail: **C** — useful enrichment, not necessary for first functional release.
- User-created muscle groups: **W** — exclude for now.

## Search, sorting and favourites

### Observed

Exercise catalogue resources/strings include:

- `exercise_sorting`
- `exercise_sorting_alphabet`
- `exercise_sorting_own_order`
- `favourites_add`
- `favourites_remove`
- `isFavourite`
- `setting_favourites_by_default`
- `favouritesByDefault`
- search UI resources (`search_bar`, `search_src_text`, `search_results`, etc.)
- `filter_type`

### Inferred

Gym Keeper supports catalogue search, filtering/type selection, sorting and favourites, including a preference to default to favourites.

### Decision

Coach-side search is much more important than personal catalogue customization. The selected client must remain in context while searching/adding exercises.

### Mezfit priority

- Search by exercise name: **M** — coach needs fast selection from a non-trivial catalogue.
- Filter by muscle group/tracking type: **S**.
- Favourites/recently used: **S** — useful accelerator for coaches repeatedly programming the same movements.
- Manual custom catalogue ordering: **W** — unnecessary complexity initially.
- "Favourites by default" setting: **W** — micro-preference.

## Custom exercises

### Observed

Gym Keeper exposes exercise create/edit/delete flows, image selection (`choose_pic_exercise.png`, `imgUriStr`) and editable classification fields.

### Inferred

Users can create exercises beyond the bundled catalogue and attach their own metadata/image.

### Decision

Mezfit needs explicit ownership/scope rather than one undifferentiated personal catalogue:

```text
ExerciseDefinition
- id
- scope: GLOBAL | COACH | CLIENT
- created_by_coach_id?
- scope_client_id?
- name
- muscle_group_id?
- tracking_type
- equipment_id?
- media_id?
- archived_at?
```

When a coach creates an exercise while editing a selected client, UI should offer at least:

- only for this client;
- for all of this coach's clients.

Historical sessions must retain enough exercise snapshot data that later renaming/editing/archiving a definition does not rewrite history.

### Mezfit priority: M

Custom exercises are required in real coaching because no global catalogue is complete. Scope and historical snapshot semantics are part of the core contract.

## Exercise media

### Observed

The APK contains Glide/GIF support and an `ex_test.gif` asset. DEX contains 334 unique exercise GIF URLs, predominantly under a CDN path shaped like:

`.../img/gifs/180/<exercise>_180.gif`

Examples found include common exercises such as Barbell Bench Press, Barbell Squat, Barbell Deadlift, Dumbbell Bench Press and Dumbbell Biceps Curl.

Exercise resources include `placeholder_exercise.png`, `choose_pic_exercise.png`, `l_exercise_image.xml`, `imgUriStr`, `getImageUrl` and `getPromoImageUrl`.

### Inferred

Gym Keeper uses animated exercise demonstrations loaded as GIFs through Glide, with local/custom image support as a fallback/override path.

### Decision

Do not copy or redistribute Gym Keeper/Muscle & Strength media merely because URLs are discoverable in the APK. Mezfit should use assets we own, license, generate lawfully, or otherwise have rights to distribute.

The media model should be independent from the exercise definition so a definition can reference an animation/image while historical rendering remains stable enough for the product's needs.

### Mezfit priority

- Exercise visual/media slot in the model/UI: **S**.
- Complete animated demonstration library: **C** for first release; high UX value but not required for the core plan/fact loop.
- Import/reuse proprietary Gym Keeper GIF library: **W**.

## Separators and highlighting

### Observed

Exercise has `isSeparator` and `isHighlighted`; APK includes `li_exercise_separator.xml` and a warning that two separators cannot be adjacent.

### Inferred

Gym Keeper uses pseudo-exercise records to provide visual organization inside exercise lists/workouts.

### Decision

Mezfit should not encode presentation separators as `ExerciseDefinition`. If sectioning becomes useful, model it explicitly as workout structure (for example section/group metadata), not as a fake exercise.

### Mezfit priority: W

No need to reproduce this representation. Supersets/groups already have a dedicated product model.

## Coach-side target UX

The highest-value adaptation of the Gym Keeper catalogue is contextual selection for one client:

```text
Clients → Andrey → Program → Workout A → Add exercise

Search: bench
Filters: Chest · Weight & reps

Bench Press
Recent client history:
01 Sep   80 × 10
05 Sep   82.5 × 8
08 Sep   82.5 × 8

Assign
1  85 × 8
2  85 × 8
3  85 × 8
Rest 90 s
Coach instruction …
```

This combines three otherwise separate Gym Keeper ideas: catalogue discovery, exercise history, and set editing. For Mezfit this is one coach decision surface.

### Mezfit priority: M

Client-specific previous performance at the moment of prescription is a core advantage of the coach workflow and is already represented in the backlog.

## Backlog implications

Existing backlog coverage should be preferred over duplicate Issues:

- exercise catalogue/custom scope → existing exercise catalogue Issue;
- type-aware result entry → existing client execution/catalogue work;
- previous client performance in editor → existing previous-performance Issue;
- supersets → existing exercise-group Issue;
- copy/reuse → existing coach copy/reuse Issue.

New standalone work is justified only where the feature has an independent delivery boundary. From this analysis, coach catalogue discovery (search/filter/favourites/recent) and exercise media can be tracked separately from the underlying catalogue persistence.
