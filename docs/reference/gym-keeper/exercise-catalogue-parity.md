# Gym Keeper exercise catalogue parity

Status: implementation evidence for Mezfit `Упражнения`. Issue #60 corrects the first #58 implementation after direct screenshot comparison exposed structural drift.

## Evidence priority

For this module the supplied Gym Keeper APK and product-owner screenshots are the primary functional/UI/UX reference. Static DEX/resource evidence is useful for discovering capabilities, but **a list of discovered features is not a substitute for reproducing the observed interaction sequence and information architecture**.

## Screenshot-confirmed catalogue flow

The verified Gym Keeper flow is:

1. `Упражнения` opens the **category list first**, not a flat exercise catalogue.
2. Primary categories are `Грудь`, `Руки`, `Спина`, `Ноги`, `Плечи`, `Корпус`, `Фулбоди`, `Кардио`, `Другое`.
3. Selecting a category opens that category's exercise list. The header uses Back + category name + Add + Search.
4. Directly under the header is a compact badge/chip filter row. The favourite filter is a star. Category-specific subgroup chips precede equipment chips where the reference exposes them. Screenshot-confirmed examples:
   - Грудь: `Середина`, `Верх`, `Низ` + `Свой вес`, `Штанга`, `Гантель x1`, `Гантели x2`, `Трос`, `Тренажер`, `Другое`;
   - Руки: `Бицепс`, `Трицепс`, `Предплечье` + equipment chips.
5. Exercise rows are compact cards with an exercise media thumbnail, title and overflow action.
6. The overflow menu is the primary catalogue action gateway and exposes `Информация`, favourite add/remove, `Дублировать`, `Редактировать` as applicable.
7. `Информация` opens the exercise info screen. The reference shows tabs `Информация`, `Статистика`, `История`, a large media area, favourite/edit affordances and metadata badges.
8. The edit action opens the exercise editor rather than a separate catalogue-specific form.

The product-owner screenshots are therefore stronger evidence than the flattened #58 UI that was initially inferred from strings/resources.

## APK resources rechecked

The supplied `com.kg.app.sportdiary_615_rs.apk` contains dedicated catalogue/selection, edit and info resources including `dialog_choose_exercises.xml`, `dialog_choose_exercises_from_day.xml`, `dialog_choose_exercises_from_workout.xml`, `dialog_edit_exercise.xml`, `activity_exercise_info.xml`, `li_exercise_small.xml`, `li_exercise_edit.xml`, `l_exercise_image.xml` and `fam_add_exercises.xml`.

Catalogue/action resources include `ic_exercise`, `ic_search`, `ic_filter`, `ic_sort_abc`, `ic_add`, `ic_edit`, `ic_edit_delete`, `ic_info`, favourite assets and overflow/menu artwork. Category artwork exists as `muscles_chest.png`, `muscles_arm.png`, `muscles_back.png`, `muscles_leg.png`, `muscles_shoulders.png`, `muscles_core.png`, `muscles_fullbody.png`, `muscles_cardio.png` and `muscles_other.png`.

## Bundled catalogue extraction

`classes2.dex` contains **334 unique exercise GIF references** under `/img/gifs/180/`. `tools/extract-gym-keeper-catalog.mjs` parses these deterministically. Migrations `0007_gym_keeper_exercise_seed_01.sql` through `0013_gym_keeper_exercise_seed_07.sql` retain stable `reference_source`, exact APK-derived `reference_key` and deterministic `reference_order` for #34 media attachment.

The source/reference identity remains technical and stable. User-facing bundled names are localized to Russian without changing `reference_key`, so media mapping is not coupled to translated display text.

## Russian product invariant

Mezfit currently has a Russian-only product UI. Bundled English source names discovered in APK data must not leak to catalogue screens, search results, metadata, menus, loading/error states or other product-owned UI. Technical source keys and user-authored content are not rewritten. The canonical rule lives in `docs/product/invariants.md`.

## Mezfit domain adaptation

Gym Keeper can use direct exercise selection against the current user's diary. Mezfit coach mode manages multiple clients, so assigning an exercise cannot blindly target `today`. That separate adaptation is tracked by #61: the coach must explicitly select client and editable target day/workout, then reuse canonical program/day editor logic.

This domain adaptation does **not** justify changing category-first navigation, filter chips, row layout or context-menu semantics in the global catalogue.

## Media boundary

#60 preserves the media slots and reference mapping but does not move the full GIF/image library into the frontend. Actual media extraction/storage/delivery remains #34 and uses R2.
