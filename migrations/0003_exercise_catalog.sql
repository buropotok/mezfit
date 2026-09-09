PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS exercise_definition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'coach', 'client')),
  owner_coach_user_id INTEGER,
  owner_client_user_id INTEGER,
  name TEXT NOT NULL,
  tracking_type TEXT NOT NULL CHECK (tracking_type IN ('weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight')),
  primary_muscle TEXT,
  equipment TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (scope = 'global' AND owner_coach_user_id IS NULL AND owner_client_user_id IS NULL)
    OR (scope = 'coach' AND owner_coach_user_id IS NOT NULL AND owner_client_user_id IS NULL)
    OR (scope = 'client' AND owner_coach_user_id IS NOT NULL AND owner_client_user_id IS NOT NULL)
  ),
  FOREIGN KEY (owner_coach_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_client_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_exercise_scope_name ON exercise_definition(scope, name);
CREATE INDEX IF NOT EXISTS idx_exercise_coach ON exercise_definition(owner_coach_user_id, is_archived, name);
CREATE INDEX IF NOT EXISTS idx_exercise_client ON exercise_definition(owner_client_user_id, is_archived, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_global_name
  ON exercise_definition(lower(name)) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_coach_name
  ON exercise_definition(owner_coach_user_id, lower(name)) WHERE scope = 'coach';
CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_client_name
  ON exercise_definition(owner_coach_user_id, owner_client_user_id, lower(name)) WHERE scope = 'client';

INSERT OR IGNORE INTO exercise_definition (scope, name, tracking_type, primary_muscle, equipment) VALUES
  ('global', 'Bench Press', 'weight_reps', 'Chest', 'Barbell'),
  ('global', 'Squat', 'weight_reps', 'Quadriceps', 'Barbell'),
  ('global', 'Deadlift', 'weight_reps', 'Back', 'Barbell'),
  ('global', 'Lat Pulldown', 'weight_reps', 'Back', 'Cable'),
  ('global', 'Seated Row', 'weight_reps', 'Back', 'Cable'),
  ('global', 'Overhead Press', 'weight_reps', 'Shoulders', 'Barbell'),
  ('global', 'Dumbbell Curl', 'weight_reps', 'Biceps', 'Dumbbell'),
  ('global', 'Triceps Pushdown', 'weight_reps', 'Triceps', 'Cable'),
  ('global', 'Leg Press', 'weight_reps', 'Quadriceps', 'Machine'),
  ('global', 'Running', 'time_distance', 'Cardio', 'None');
