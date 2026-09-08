# Gym Keeper: settings, auto-fill, units and timer

Status legend: **Observed** = directly present in APK resources/DEX; **Inferred** = reconstructed behavior requiring runtime confirmation.

## Units

### Observed

The APK contains two unit-system labels:

- `units_kg_km`
- `units_lb_mi`

Individual unit resources include:

- `unit_kg`
- `unit_lb`
- `unit_km`
- `unit_mi`
- `unit_m`
- `unit_yd`

Realm/settings data contains `unitsId`.

### Product implication

Mezfit should not store display-unit strings as authoritative values. Canonical values should use a stable internal unit system, with coach/client display preferences applied at the API/UI boundary. Program prescriptions and historical snapshots must preserve semantic quantity when display units change.

## Auto-fill subsystem

### Observed

Settings/model symbols found in DEX:

- `autoFillModeId`
- `autoFillCopySetModeId`
- `autoFillSetsModeId`
- `autoFillWeightsFromDayModeId`
- `autoFillWeightsFromProgramModeId`
- `autoFillProgramSets`
- `autoFillOptionDayComment`
- `autoFillOptionDifficulty`
- `autoFillOptionExerciseComment`
- `autoFillOptionExerciseComments`
- `autoFillOptionSetDifficulties`
- `autoFillOptionWeightDistance`
- `getAutoFillCopySetMode`
- `getAutoFillWeightsFromDayMode`
- `getAutoFilledSet`
- `setAutoFillCopySetMode`
- `setAutoFillWeightsFromDayMode`

Resource strings include:

- `auto_fill_help`
- `auto_fill_mode_copy_last`
- `auto_fill_mode_copy_prev_related`
- `auto_fill_option_day_comment`
- `auto_fill_option_difficulties`
- `auto_fill_options`
- `auto_fill_sets_not_add_sets`
- `copy_sets`

Previously observed strings additionally indicate several set-filling combinations: automatic/copy/empty weight with automatic/copy reps.

### Inferred

Gym Keeper treats auto-fill as a configurable policy rather than a single “copy previous workout” switch. Sources can include the current/previous day and program, and metadata such as difficulty/comments can optionally be copied.

The presence of `getAutoFilledSet` suggests set creation itself passes through an auto-fill decision layer.

### Mezfit decision direction

Do **not** copy this subsystem literally into client settings. In Mezfit the coach plan is authoritative. The useful behavior should be split into three concepts:

1. `PlannedSet` — coach prescription.
2. `previous_result` — backend-provided historical context.
3. `SetResult` — today's actual value, initially prefilled from plan where appropriate.

A client action such as “add another set” may use a deterministic convenience policy (for example copy the previous actual set), but it must create FACT and must not mutate the coach plan.

Coach-side editing can offer explicit copy helpers (copy previous prescription, previous actual result, another day/program) without hiding provenance.

## Timer

### Observed

Settings/model fields:

- `timerInitSeconds`
- `timerAutoStart`
- `timerSound`
- `timerAltSound`
- `timerVibro`
- `timerDelta`
- `timerTabataPrepareSeconds`
- `timerTabataWorkSeconds`
- `timerTabataRestSeconds`
- `timerTabataRounds`

Resources:

- `timer_autostart_add_set`
- `timer_option_type_normal`
- `timer_option_type_tabata`
- `timer_option_duration`
- `timer_option_interval`
- `timer_option_tabata_rounds`
- `timer_progress_rest`
- `timer_sound_main`
- `timer_sound_alt`
- `timer_sound_disabled`
- `timer_vibro`

Raw audio assets include normal and alternate beep/finish sounds plus Tabata sounds.

### Inferred

The normal rest timer can auto-start when a set is added/completed. Tabata is a separate interval mode with prepare/work/rest/round parameters.

### Mezfit decision direction

For MVP retain only the workout-relevant rest timer:

- coach may prescribe `rest_seconds` at exercise/set level;
- completing a set starts the timer automatically;
- client can skip/restart/adjust the current timer without modifying the prescription;
- use Telegram Mini App haptics where supported.

Full Tabata/interval-timer functionality is not required for MVP.

## Workout duration

### Observed

Resources include:

- `workout_time_auto`
- `workout_time_manual`
- `workout_time_auto_explained`

Model data includes `durationMin`.

### Product implication

Mezfit already has a cleaner execution lifecycle: `WorkoutSession.started_at` / `completed_at`. Duration should normally be derived from those timestamps. A manual correction can be supported later as explicit corrected metadata rather than replacing the event timestamps.

## Open questions for runtime/sample verification

- Exact numeric enum values for each auto-fill mode.
- Exact precedence between program values and previous-day values.
- Whether auto-fill happens on workout creation, exercise insertion, set insertion, or multiple stages.
- Whether unit-system changes rewrite stored values or only affect presentation.
- Exact semantics of `timerDelta`.
