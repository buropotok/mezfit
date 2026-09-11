PRAGMA foreign_keys = ON;

CREATE TABLE exercise_definition_override (
  coach_user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  exercise_definition_id INTEGER NOT NULL REFERENCES exercise_definition(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  tracking_type TEXT NOT NULL CHECK (tracking_type IN ('weight_reps','time','time_distance','time_reps','time_weight')),
  category_code TEXT NOT NULL,
  equipment_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (coach_user_id, exercise_definition_id)
);
