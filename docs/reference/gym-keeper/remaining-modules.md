# Gym Keeper — Remaining modules inventory

## Purpose

Final static-analysis inventory of meaningful Gym Keeper features not already covered in the dedicated exercise, stats, backup, calendar, settings, and workout-editor notes.

Each item is classified as Observed/Inferred and translated to a Mezfit priority.

## Notebook

### Observed

- `NotebookActivity`
- `activity_notebook.xml`
- persisted `notebook`
- `Notebook`, `Notebook is empty`, `notebook_save_changes`

### Interpretation

This is a free-form local journal/notepad associated with the application/diary context.

### Mezfit priority: W

A generic notebook does not serve the core coach-client workflow. Structured coach instructions, client notes, and Telegram-linked feedback provide more useful context.

---

## Results / medals / share

### Observed

Resources include:

- `ResultActivity`
- `fragment_result_medals.xml`
- `fragment_result_picture.xml`
- `fragment_result_text.xml`
- `l_stat_medal.xml`
- `l_stat_share.xml`
- `New record!`
- `New records!`
- `Medals`
- `Share`
- result/share icons

### Interpretation

Gym Keeper includes motivational post-workout result surfaces and shareable achievements.

### Mezfit priority: W initially

This is not necessary for coach-prescribed training. Records can exist as analytics later without medals/social cards.

---

## Calculators

### Observed

- `CalcsActivity`
- estimated one-rep max
- plate calculator
- BMI
- calorie/macronutrient and heart-rate-zone strings
- `Make start page for calculator`

### Mezfit priorities

- Estimated 1RM: **C** — useful derived metric for strength programming.
- Plate calculator: **W/C** — convenient but unrelated to the core product loop.
- BMI/calorie/macronutrient calculators: **W** for initial Mezfit.
- Heart-rate-zone calculator: **W** unless endurance coaching becomes a defined product scope.

---

## Measurements and photos

Covered in `stats-measurements.md`; final-priority interpretation:

- Body measurement records: **S**.
- Progress photos: **S/C** depending on first coach segment.
- Custom measurement definitions: **C**.
- Generic measurement record cleanup policies: **W**; backend retention should be a platform concern.

---

## Exercise records and charts

Covered in `stats-measurements.md` and `exercise-system.md`.

### Mezfit priority: C

Useful after the execution history is reliable. Do not make records authoritative state; derive them from completed session results.

---

## Backup / restore / Google Drive

### Observed

Gym Keeper contains a substantial local-data backup subsystem:

- `Backup & Restore`
- local backup entries and restore dialogs
- automatic Google Drive backup
- reserve backup handling
- backup validation
- Realm `writeCopy` / `writeCopyTo`
- `GymKeeper Data (dbi)` and `.dbi` selection

### Mezfit priority: W as a user feature

Mezfit is backend-backed. Device-level database backup should not be exposed as an end-user product primitive. Instead use normal server durability, backups, migrations, and auditability.

### Migration exception

Gym Keeper import remains **S** because it lowers switching cost. Import is not the same thing as Mezfit backup/restore.

---

## Export

### Observed

Gym Keeper can export:

- journal
- program
- CSV table
- text
- app-specific data format

### Mezfit priorities

- Gym Keeper import adapter: **S**.
- Mezfit data export for portability: **C/S** later, depending on product/legal requirements.
- CSV/text reporting: **C**.

---

## Data optimization / cleanup

### Observed

- `Optimize data (beta)`
- delete records older than configured periods
- warning to create backup first

### Mezfit priority: W

This exists because Gym Keeper owns a long-lived local Realm database. In Mezfit, database maintenance and retention belong to backend operations, not client UX.

---

## Themes and interface personalization

### Observed

Multiple light/dark/black/auto themes, exercise-image colorization, layout preferences, compact add-set buttons, separated add buttons, hints, first-day-of-week and sorting options.

### Mezfit priority: W/C

Use Telegram/web theme integration and a deliberately opinionated workflow initially. Avoid exposing configuration for every micro-interaction.

---

## Notifications / timer background behavior

### Observed

Gym Keeper requests notification/alarm capabilities to keep its timer alive in the Android background and warns about battery optimization.

### Mezfit translation

A Telegram Mini App has different lifecycle constraints. Do not copy Android foreground-service behavior. Timer correctness should be derived from timestamps (`target_end_at`) so reopening the app reconstructs remaining time.

### Mezfit priority: S for rest timer; W for Android-specific background-service controls

---

## RPE/RIR and difficulty

### Observed

Gym Keeper has both a simple difficulty concept and visible `RPE/RIR` terminology.

### Mezfit priority: C

Keep the data model extensible, but do not require effort entry for every set in MVP.

---

## Resistance bands / barbell setup

### Observed

Gym Keeper stores `Band`, `BarbellPart`, weight/unit settings and has editors for resistance bands, barbell bars and plates.

### Mezfit priority: W initially

These are personal equipment utilities rather than coach-client workflow primitives.

---

## Exercise replacement

### Observed

- `Replace exercise`
- warning that historical entries are retained/reassigned when deleting/replacing catalogue exercises
- `This exercise is already in the workout. Add another one?`

### Mezfit interpretation

Catalogue lifecycle and historical snapshots must be independent. Deleting/archiving a definition must not destroy session history.

### Mezfit priority: M for archival/snapshot safety; S for explicit coach-side replacement UX

Existing catalogue/editor issues cover the underlying requirement.

---

## Day movement / empty-day skipping

### Observed

- `Move day`
- `Move / Delete day`
- `Day moved to`
- `Skip empty days`
- `hideEmptyDays`
- `pastDaysBound`

### Mezfit translation

The useful product concept is rescheduling an occurrence, not moving a diary object.

### Mezfit priority: S

A client/coach should eventually be able to postpone/reschedule/skip a planned occurrence without rewriting program structure or historical sessions.

---

## Monetization and trial UI

### Observed

Gym Keeper has purchase/subscription/trial infrastructure and storefront-specific strings.

### Mezfit priority: W for current product-discovery stage

No conclusions about Mezfit monetization should be inherited from Gym Keeper.

---

## Final exclusion list

The following Gym Keeper capabilities should not be treated as requirements merely because they exist in the APK:

- built-in training programs
- multiple local journals
- local Realm backup/restore UX
- Google Drive backup UI
- data optimization/record pruning controls
- notebook
- medals/result sharing
- Tabata timer
- complex set autofill policies
- timer sound customization
- extensive theme/layout customization
- barbell plate inventory
- resistance-band inventory
- generic calorie/BMI utilities

These are reference-only findings.