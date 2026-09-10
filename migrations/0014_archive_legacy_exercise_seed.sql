PRAGMA foreign_keys = ON;

-- The original 0003 rows were development fixtures. Keep them archived rather
-- than deleting them so any early references remain resolvable while the
-- APK-derived bundled catalogue becomes the effective product catalogue.
UPDATE exercise_definition
SET is_archived = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE scope = 'global'
  AND reference_source IS NULL
  AND name IN (
    'Bench Press',
    'Squat',
    'Deadlift',
    'Lat Pulldown',
    'Seated Row',
    'Overhead Press',
    'Dumbbell Curl',
    'Triceps Pushdown',
    'Leg Press',
    'Running'
  );
