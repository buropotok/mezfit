PRAGMA foreign_keys = ON;

ALTER TABLE exercise_definition ADD COLUMN description TEXT;
ALTER TABLE exercise_definition ADD COLUMN category_code TEXT CHECK (
  category_code IS NULL OR category_code IN (
    'chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio', 'other'
  )
);
ALTER TABLE exercise_definition ADD COLUMN equipment_code TEXT CHECK (
  equipment_code IS NULL OR equipment_code IN (
    'bodyweight', 'barbell', 'dumbbell_single', 'dumbbell_pair', 'cable', 'machine', 'other'
  )
);

UPDATE exercise_definition
SET category_code = CASE
  WHEN lower(primary_muscle) IN ('chest') THEN 'chest'
  WHEN lower(primary_muscle) IN ('biceps', 'triceps', 'arms') THEN 'arms'
  WHEN lower(primary_muscle) IN ('back') THEN 'back'
  WHEN lower(primary_muscle) IN ('quadriceps', 'hamstrings', 'glutes', 'legs') THEN 'legs'
  WHEN lower(primary_muscle) IN ('shoulders') THEN 'shoulders'
  WHEN lower(primary_muscle) IN ('core', 'abs') THEN 'core'
  WHEN lower(primary_muscle) IN ('cardio') THEN 'cardio'
  WHEN primary_muscle IS NOT NULL THEN 'other'
  ELSE NULL
END
WHERE category_code IS NULL;

UPDATE exercise_definition
SET equipment_code = CASE
  WHEN lower(equipment) IN ('none', 'bodyweight') THEN 'bodyweight'
  WHEN lower(equipment) = 'barbell' THEN 'barbell'
  WHEN lower(equipment) = 'dumbbell' THEN 'dumbbell_single'
  WHEN lower(equipment) = 'cable' THEN 'cable'
  WHEN lower(equipment) = 'machine' THEN 'machine'
  WHEN equipment IS NOT NULL THEN 'other'
  ELSE NULL
END
WHERE equipment_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_category ON exercise_definition(category_code, is_archived, name);
