PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE workout_session_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_program_phase_id INTEGER,
  source_program_day_id INTEGER,
  started_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed')),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'draft' AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'active' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_phase_id) REFERENCES program_phase(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_day_id) REFERENCES program_day(id) ON DELETE RESTRICT,
  FOREIGN KEY (started_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE session_exercise_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_session_id INTEGER NOT NULL,
  exercise_definition_id INTEGER NOT NULL,
  source_program_exercise_id INTEGER,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'skipped', 'inactive')),
  added_by_user_id INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workout_session_id) REFERENCES workout_session_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (exercise_definition_id) REFERENCES exercise_definition(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_exercise_id) REFERENCES program_exercise(id) ON DELETE RESTRICT,
  FOREIGN KEY (added_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE session_set_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_exercise_id INTEGER NOT NULL,
  source_program_set_id INTEGER,
  position INTEGER NOT NULL CHECK (position >= 0),
  planned_reps INTEGER CHECK (planned_reps IS NULL OR planned_reps >= 0),
  planned_weight REAL CHECK (planned_weight IS NULL OR planned_weight >= 0),
  planned_duration_seconds INTEGER CHECK (planned_duration_seconds IS NULL OR planned_duration_seconds >= 0),
  planned_distance_meters REAL CHECK (planned_distance_meters IS NULL OR planned_distance_meters >= 0),
  actual_reps INTEGER CHECK (actual_reps IS NULL OR actual_reps >= 0),
  actual_weight REAL CHECK (actual_weight IS NULL OR actual_weight >= 0),
  actual_duration_seconds INTEGER CHECK (actual_duration_seconds IS NULL OR actual_duration_seconds >= 0),
  actual_distance_meters REAL CHECK (actual_distance_meters IS NULL OR actual_distance_meters >= 0),
  set_label TEXT CHECK (set_label IS NULL OR set_label IN ('warmup', 'easy', 'normal', 'hard', 'drop')),
  rpe INTEGER CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  comment TEXT,
  bands_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_exercise_id) REFERENCES session_exercise_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_set_id) REFERENCES program_set(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

INSERT INTO workout_session_next (
  id, user_id, source_program_phase_id, source_program_day_id, started_by_user_id,
  status, started_at, completed_at, created_at, updated_at
)
SELECT
  id, user_id, source_program_phase_id, source_program_day_id, started_by_user_id,
  status, started_at, completed_at, created_at, updated_at
FROM workout_session;

INSERT INTO session_exercise_next (
  id, workout_session_id, exercise_definition_id, source_program_exercise_id, position,
  status, added_by_user_id, notes, created_at, updated_at
)
SELECT
  id, workout_session_id, exercise_definition_id, source_program_exercise_id, position,
  status, added_by_user_id, notes, created_at, updated_at
FROM session_exercise;

INSERT INTO session_set_next (
  id, session_exercise_id, source_program_set_id, position,
  planned_reps, planned_weight, planned_duration_seconds, planned_distance_meters,
  actual_reps, actual_weight, actual_duration_seconds, actual_distance_meters,
  set_label, rpe, comment, bands_json,
  status, created_by_user_id, updated_by_user_id, created_at, updated_at
)
SELECT
  id, session_exercise_id, source_program_set_id, position,
  planned_reps, planned_weight, planned_duration_seconds, planned_distance_meters,
  actual_reps, actual_weight, actual_duration_seconds, actual_distance_meters,
  NULL, NULL, NULL, NULL,
  status, created_by_user_id, updated_by_user_id, created_at, updated_at
FROM session_set;

DROP TABLE session_set;
DROP TABLE session_exercise;
DROP TABLE workout_session;

ALTER TABLE workout_session_next RENAME TO workout_session;
ALTER TABLE session_exercise_next RENAME TO session_exercise;
ALTER TABLE session_set_next RENAME TO session_set;

CREATE UNIQUE INDEX uq_workout_session_open_user
  ON workout_session(user_id)
  WHERE status IN ('draft', 'active');
CREATE INDEX idx_workout_session_user_started ON workout_session(user_id, started_at DESC);
CREATE UNIQUE INDEX uq_session_exercise_position ON session_exercise(workout_session_id, position);
CREATE INDEX idx_session_exercise_session_status ON session_exercise(workout_session_id, status, position);
CREATE INDEX idx_session_exercise_source ON session_exercise(source_program_exercise_id) WHERE source_program_exercise_id IS NOT NULL;
CREATE UNIQUE INDEX uq_session_set_position ON session_set(session_exercise_id, position);
CREATE INDEX idx_session_set_exercise_status ON session_set(session_exercise_id, status, position);
CREATE INDEX idx_session_set_source ON session_set(source_program_set_id) WHERE source_program_set_id IS NOT NULL;

PRAGMA foreign_key_check;
