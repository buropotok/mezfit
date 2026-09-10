# Gym Keeper exercise catalogue parity

Status: implementation evidence for Mezfit `Упражнения`. Issue #60 corrects the first #58 implementation after direct screenshot comparison exposed structural drift; #63 completes APK parity for canonical Russian exercise names and category artwork.

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

Catalogue/action resources include `ic_exercise`, `ic_search`, `ic_filter`, `ic_sort_abc`, `ic_add`, `ic_edit`, `ic_edit_delete`, `ic_info`, favourite assets and overflow/menu artwork.

## Canonical Russian exercise names

`classes2.dex` contains the bundled exercise records with the APK-provided Russian display name, technical/source identity and `/img/gifs/180/...` media reference. `tools/extract-gym-keeper-catalog.mjs` now extracts that record mapping directly instead of deriving a display name from the GIF filename.

For the 334 bundled exercises used by Mezfit the extractor requires complete mapping coverage and fails rather than silently transliterating an English/source name. Migration `0014_gym_keeper_russian_names.sql` updates the already-deployed `gym_keeper_apk` definitions using their stable APK identity/order while preserving `reference_source`, `reference_key`, `reference_order` and the #34 media join.

Example: the APK record associated with `12411305-Bird-Dog-male_Back_180.gif` is shown as `Птица-собака`. Mezfit therefore stores/displays `Птица-собака`; `Бирд Дог мале` and similar generated transliterations are not canonical product data.

**Invariant:** when Gym Keeper supplies a localized Russian exercise name, that exact APK value wins. Do not translate, transliterate or normalize it in the runtime UI. Coach-created names remain user-authored data.

## Gym Keeper category artwork

The category-first screen uses the exact PNG artwork extracted from the approved APK and served from `public/gym-keeper/categories/`:

- `muscles_chest.png` → Грудь
- `muscles_arm.png` → Руки
- `muscles_back.png` → Спина
- `muscles_leg.png` → Ноги
- `muscles_shoulders.png` → Плечи
- `muscles_core.png` → Корпус
- `muscles_fullbody.png` → Фулбоди
- `muscles_cardio.png` → Кардио
- `muscles_other.png` → Другое

The artwork is not redrawn and no third-party icon family substitutes it. Mezfit may apply the existing category accent treatment so the same reference assets remain legible across supported themes.

## Russian product invariant

Mezfit currently has a Russian-only product UI. Bundled English source names discovered in APK data must not leak to catalogue screens, search results, metadata, menus, loading/error states or other product-owned UI. Technical source keys and user-authored content are not rewritten. The canonical rule lives in `docs/product/invariants.md`.

## Mezfit domain adaptation

Gym Keeper can use direct exercise selection against the current user's diary. Mezfit coach mode manages multiple clients, so assigning an exercise cannot blindly target `today`. That separate adaptation is tracked by #61: the coach must explicitly select client and editable target day/workout, then reuse canonical program/day editor logic.

This domain adaptation does **not** justify changing category-first navigation, filter chips, row layout or context-menu semantics in the global catalogue.

## Media boundary

#63 adds only the lightweight category UI artwork. Full exercise GIF/image extraction, R2 storage and runtime delivery remain #34 and reuse the preserved `reference_key` mapping.
