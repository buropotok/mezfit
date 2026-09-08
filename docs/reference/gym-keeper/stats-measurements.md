# Gym Keeper reference: stats, records and measurements

This document records findings from static analysis of the Gym Keeper Android APK. It is reference material, not a Mezfit product specification.

## Confirmed screens and resources

The APK contains dedicated activities/layouts for:

- `StatsActivity` / `activity_stats.xml`
- `ChartActivity` / `activity_chart.xml`
- `MeasureRecordsActivity` / `activity_measure_records.xml`
- `MeasurePhotoActivity` / `activity_measure_photo.xml`
- `fragment_info_stats.xml`
- `li_exercise_records.xml`
- `l_record_line.xml`
- `l_stat.xml`, `l_stat_line.xml`, `l_stat_medal.xml`, `l_stat_share.xml`

The app bundles both HelloCharts and MPAndroidChart-related classes, so charting is a first-class subsystem rather than a simple text summary.

## General workout statistics

Strings found in DEX include:

- `stat_workouts`
- `stat_exercises`
- `stat_count_days`
- `stat_count_sets`
- `stat_duration`
- `stat_volume`
- `stat_total_volume`
- `stat_daily`
- `stat_weekly`
- `stat_monthly`

This confirms aggregation by workout count, exercise count, training days, set count, duration and training volume, with selectable time periods.

Settings persist `statGeneralDefaultId` and `statPeriodDefaultId`, indicating remembered default statistic and period selections.

## Exercise statistics and records

The APK contains record/stat identifiers:

- `MAX_WEIGHT`
- `MAX_REPS`
- `MAX_DISTANCE`
- `MAX_TIME`
- `MAX_REPS_PER_MIN`
- `TOTAL_REPS`
- `TOTAL_DISTANCE`
- `TOTAL_TIME`
- `TOTAL_SETS`
- `TOTAL_VOLUME`
- `TOTAL_WORKOUTS`
- `EST_ONE_REP_MAX`

There is also a dedicated one-rep-max calculator (`fragment_calc_one_rep_max`, `li_one_rep_max`, `est_one_rep_max`).

Settings persist defaults per exercise tracking mode:

- `statExerciseDefaultWeightRepsId`
- `statExerciseDefaultTimeRepsId`
- `statExerciseDefaultTimeWeightId`
- `statExerciseDefaultTimeDistanceId`

This supports the earlier finding that exercise statistics are type-aware rather than assuming every exercise is weight × reps.

## Measurements

Confirmed built-in measurement labels:

- weight
- body fat
- neck
- shoulder
- chest
- arm
- forearm
- waist
- thigh
- calf

Relevant Realm accessors indicate at least these concepts:

- `Measure`
- `MeasureRecord`
- `measureId`
- `date`
- `comment`
- `unitsId`
- `photoUriStr`
- collections of measures and measure records

The UI supports creating/editing/deleting both measurement definitions and measurement records. This suggests custom measurements in addition to built-in ones.

## Progress photos

A dedicated `MeasurePhotoActivity`, photo icons, `photoUriStr`, and PhotoView dependency confirm that progress photos are explicitly linked to the measurement/progress subsystem.

## Chart configuration

Persisted settings include:

- `chartZeroBaseline`
- `chartProportionalSpacing`

This indicates user-configurable chart rendering behavior.

## Reference interpretation

Gym Keeper treats progress as several related but distinct domains:

1. workout aggregates;
2. exercise-specific history and records;
3. body measurements;
4. progress photos;
5. charts over those histories.

For Mezfit, these mechanics are useful reference material, but the presentation should be redesigned around coach/client monitoring rather than copied as a personal statistics dashboard.
