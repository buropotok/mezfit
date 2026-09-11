PRAGMA foreign_keys = ON;

ALTER TABLE exercise_definition ADD COLUMN name_en TEXT;
ALTER TABLE exercise_dataset_stage ADD COLUMN name_en TEXT;

CREATE INDEX IF NOT EXISTS idx_exercise_global_name_en
  ON exercise_definition(lower(name_en))
  WHERE scope = 'global' AND name_en IS NOT NULL;
