PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Rebuild the complete training-program/workout graph so the deployed
-- UNIQUE constraint on training_plan.user_id can be removed without breaking
-- RESTRICT foreign keys or losing historical workout provenance.
CREATE TABLE training_plan_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE program_phase_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  training_plan_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'finished')),
  planned_start_date TEXT,
  planned_end_date TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (planned_start_date IS NULL OR planned_end_date IS NULL OR planned_start_date <= planned_end_date),
  FOREIGN KEY (training_plan_id) REFERENCES training_plan_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE program_day_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_phase_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  deprecated_at TEXT,
  deprecated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'active' AND deprecated_at IS NULL AND deprecated_by_user_id IS NULL) OR status = 'deprecated'),
  FOREIGN KEY (program_phase_id) REFERENCES program_phase_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (deprecated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE program_exercise_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_day_id INTEGER NOT NULL,
  exercise_definition_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  deprecated_at TEXT,
  deprecated_by_user_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'active' AND deprecated_at IS NULL AND deprecated_by_user_id IS NULL) OR status = 'deprecated'),
  FOREIGN KEY (program_day_id) REFERENCES program_day_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (exercise_definition_id) REFERENCES exercise_definition(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (deprecated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE program_set_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_exercise_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  weight REAL CHECK (weight IS NULL OR weight >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  distance_meters REAL CHECK (distance_meters IS NULL OR distance_meters >= 0),
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  deprecated_at TEXT,
  deprecated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'active' AND deprecated_at IS NULL AND deprecated_by_user_id IS NULL) OR status = 'deprecated'),
  FOREIGN KEY (program_exercise_id) REFERENCES program_exercise_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (deprecated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE TABLE workout_session_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_program_phase_id INTEGER,
  source_program_day_id INTEGER,
  started_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'active' AND completed_at IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL)),
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_phase_id) REFERENCES program_phase_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_day_id) REFERENCES program_day_next(id) ON DELETE RESTRICT,
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
  FOREIGN KEY (source_program_exercise_id) REFERENCES program_exercise_next(id) ON DELETE RESTRICT,
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_exercise_id) REFERENCES session_exercise_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_set_id) REFERENCES program_set_next(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

INSERT INTO training_plan_next SELECT * FROM training_plan;
INSERT INTO program_phase_next SELECT * FROM program_phase;
INSERT INTO program_day_next SELECT * FROM program_day;
INSERT INTO program_exercise_next SELECT * FROM program_exercise;
INSERT INTO program_set_next SELECT * FROM program_set;
INSERT INTO workout_session_next SELECT * FROM workout_session;
INSERT INTO session_exercise_next SELECT * FROM session_exercise;
INSERT INTO session_set_next SELECT * FROM session_set;

DROP TABLE session_set;
DROP TABLE session_exercise;
DROP TABLE workout_session;
DROP TABLE program_set;
DROP TABLE program_exercise;
DROP TABLE program_day;
DROP TABLE program_phase;
DROP TABLE training_plan;

ALTER TABLE training_plan_next RENAME TO training_plan;
ALTER TABLE program_phase_next RENAME TO program_phase;
ALTER TABLE program_day_next RENAME TO program_day;
ALTER TABLE program_exercise_next RENAME TO program_exercise;
ALTER TABLE program_set_next RENAME TO program_set;
ALTER TABLE workout_session_next RENAME TO workout_session;
ALTER TABLE session_exercise_next RENAME TO session_exercise;
ALTER TABLE session_set_next RENAME TO session_set;

CREATE INDEX idx_training_plan_user_id ON training_plan(user_id);
CREATE UNIQUE INDEX uq_program_phase_position ON program_phase(training_plan_id, position);
CREATE UNIQUE INDEX uq_program_phase_active ON program_phase(training_plan_id) WHERE status = 'active';
CREATE INDEX idx_program_phase_plan_status ON program_phase(training_plan_id, status, position);
CREATE UNIQUE INDEX uq_program_day_position ON program_day(program_phase_id, position) WHERE status = 'active';
CREATE INDEX idx_program_day_phase_status ON program_day(program_phase_id, status, position);
CREATE UNIQUE INDEX uq_program_exercise_position ON program_exercise(program_day_id, position) WHERE status = 'active';
CREATE INDEX idx_program_exercise_day_status ON program_exercise(program_day_id, status, position);
CREATE INDEX idx_program_exercise_definition ON program_exercise(exercise_definition_id);
CREATE UNIQUE INDEX uq_program_set_position ON program_set(program_exercise_id, position) WHERE status = 'active';
CREATE INDEX idx_program_set_exercise_status ON program_set(program_exercise_id, status, position);
CREATE UNIQUE INDEX uq_workout_session_active_user ON workout_session(user_id) WHERE status = 'active';
CREATE INDEX idx_workout_session_user_started ON workout_session(user_id, started_at DESC);
CREATE UNIQUE INDEX uq_session_exercise_position ON session_exercise(workout_session_id, position);
CREATE INDEX idx_session_exercise_session_status ON session_exercise(workout_session_id, status, position);
CREATE INDEX idx_session_exercise_source ON session_exercise(source_program_exercise_id) WHERE source_program_exercise_id IS NOT NULL;
CREATE UNIQUE INDEX uq_session_set_position ON session_set(session_exercise_id, position);
CREATE INDEX idx_session_set_exercise_status ON session_set(session_exercise_id, status, position);
CREATE INDEX idx_session_set_source ON session_set(source_program_set_id) WHERE source_program_set_id IS NOT NULL;

PRAGMA foreign_key_check;
