PRAGMA foreign_keys = ON;

-- Long-lived training plan owned by a user regardless of their role.
-- The user's role (coach/client) controls mutation permissions at the API layer.
CREATE TABLE IF NOT EXISTS training_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

-- A phase is a logical block such as "Month 1". Dates are planning guidance;
-- phase transitions are explicit and are not driven automatically by dates.
CREATE TABLE IF NOT EXISTS program_phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  training_plan_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'finished')),
  planned_start_date TEXT,
  planned_end_date TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    planned_start_date IS NULL
    OR planned_end_date IS NULL
    OR planned_start_date <= planned_end_date
  ),
  FOREIGN KEY (training_plan_id) REFERENCES training_plan(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_phase_position
  ON program_phase(training_plan_id, position);

-- At most one current phase per training plan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_phase_active
  ON program_phase(training_plan_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_program_phase_plan_status
  ON program_phase(training_plan_id, status, position);

CREATE TABLE IF NOT EXISTS program_day (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_phase_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  deprecated_at TEXT,
  deprecated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'active' AND deprecated_at IS NULL AND deprecated_by_user_id IS NULL)
    OR status = 'deprecated'
  ),
  FOREIGN KEY (program_phase_id) REFERENCES program_phase(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (deprecated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_day_position
  ON program_day(program_phase_id, position)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_program_day_phase_status
  ON program_day(program_phase_id, status, position);

-- Assignment of an exercise definition to a concrete program day.
-- Deprecation is local to the program; the exercise catalog entry is untouched.
CREATE TABLE IF NOT EXISTS program_exercise (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_day_id INTEGER NOT NULL,
  exercise_definition_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  deprecated_at TEXT,
  deprecated_by_user_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'active' AND deprecated_at IS NULL AND deprecated_by_user_id IS NULL)
    OR status = 'deprecated'
  ),
  FOREIGN KEY (program_day_id) REFERENCES program_day(id) ON DELETE RESTRICT,
  FOREIGN KEY (exercise_definition_id) REFERENCES exercise_definition(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (deprecated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_exercise_position
  ON program_exercise(program_day_id, position)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_program_exercise_day_status
  ON program_exercise(program_day_id, status, position);

CREATE INDEX IF NOT EXISTS idx_program_exercise_definition
  ON program_exercise(exercise_definition_id);

-- Planned prescription. The nullable metric columns intentionally support the
-- existing exercise tracking types: weight_reps, time, time_distance,
-- time_reps and time_weight. Values use canonical storage units.
CREATE TABLE IF NOT EXISTS program_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_exercise_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  weight REAL CHECK (weight IS NULL OR weight >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  distance_meters REAL CHECK (distance_meters IS NULL OR distance_meters >= 0),
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  deprecated_at TEXT,
  deprecated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'active' AND deprecated_at IS NULL AND deprecated_by_user_id IS NULL)
    OR status = 'deprecated'
  ),
  FOREIGN KEY (program_exercise_id) REFERENCES program_exercise(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (deprecated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_set_position
  ON program_set(program_exercise_id, position)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_program_set_exercise_status
  ON program_set(program_exercise_id, status, position);

-- Actual workout. Once started, the session is independent from the plan.
CREATE TABLE IF NOT EXISTS workout_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_program_phase_id INTEGER,
  source_program_day_id INTEGER,
  started_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'active' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  ),
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_phase_id) REFERENCES program_phase(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_day_id) REFERENCES program_day(id) ON DELETE RESTRICT,
  FOREIGN KEY (started_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

-- Current Workout Session: a user can have at most one active session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_session_active_user
  ON workout_session(user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_workout_session_user_started
  ON workout_session(user_id, started_at DESC);

-- Factual exercise inside a session. A NULL source means it was added ad-hoc.
-- Exercise identity remains the referenced exercise_definition; mutable display
-- metadata is intentionally not snapshotted here. tracking_type immutability is
-- enforced separately (see issue #111) because it defines result semantics.
CREATE TABLE IF NOT EXISTS session_exercise (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_session_id INTEGER NOT NULL,
  exercise_definition_id INTEGER NOT NULL,
  source_program_exercise_id INTEGER,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'completed', 'skipped', 'inactive')),
  added_by_user_id INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workout_session_id) REFERENCES workout_session(id) ON DELETE RESTRICT,
  FOREIGN KEY (exercise_definition_id) REFERENCES exercise_definition(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_exercise_id) REFERENCES program_exercise(id) ON DELETE RESTRICT,
  FOREIGN KEY (added_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_exercise_position
  ON session_exercise(workout_session_id, position);

CREATE INDEX IF NOT EXISTS idx_session_exercise_session_status
  ON session_exercise(workout_session_id, status, position);

CREATE INDEX IF NOT EXISTS idx_session_exercise_source
  ON session_exercise(source_program_exercise_id)
  WHERE source_program_exercise_id IS NOT NULL;

-- Planned values are copied into the session at workout start. Actual values
-- then evolve independently. source_program_set_id is provenance only.
CREATE TABLE IF NOT EXISTS session_set (
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
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'skipped')),
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_exercise_id) REFERENCES session_exercise(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_program_set_id) REFERENCES program_set(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_set_position
  ON session_set(session_exercise_id, position);

CREATE INDEX IF NOT EXISTS idx_session_set_exercise_status
  ON session_set(session_exercise_id, status, position);

CREATE INDEX IF NOT EXISTS idx_session_set_source
  ON session_set(source_program_set_id)
  WHERE source_program_set_id IS NOT NULL;
