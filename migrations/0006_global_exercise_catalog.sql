PRAGMA foreign_keys = ON;

ALTER TABLE exercise_definition ADD COLUMN reference_source TEXT;
ALTER TABLE exercise_definition ADD COLUMN reference_key TEXT;
ALTER TABLE exercise_definition ADD COLUMN reference_media_url TEXT;
ALTER TABLE exercise_definition ADD COLUMN reference_order INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_reference
  ON exercise_definition(reference_source, reference_key)
  WHERE reference_source IS NOT NULL AND reference_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_reference_order
  ON exercise_definition(reference_source, reference_order, name);

CREATE TABLE IF NOT EXISTS coach_exercise_favourite (
  coach_user_id INTEGER NOT NULL,
  exercise_definition_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (coach_user_id, exercise_definition_id),
  FOREIGN KEY (coach_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_definition_id) REFERENCES exercise_definition(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_exercise_favourite_exercise
  ON coach_exercise_favourite(exercise_definition_id, coach_user_id);
