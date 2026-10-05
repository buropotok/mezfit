PRAGMA foreign_keys = ON;

-- Calendar dimension used by scheduled workout occurrences. date_key is YYYYMMDD
-- so equality and range scans preserve chronological order without date joins.
CREATE TABLE calendar_day (
  date_key INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 9999),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  iso_week INTEGER NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7)
);

CREATE INDEX idx_calendar_day_year_month_day
  ON calendar_day(year, month, day);

CREATE INDEX idx_calendar_day_iso_week
  ON calendar_day(year, iso_week, weekday);

-- A calendar occurrence is the expected workout appointment. It deliberately
-- stores only scheduling/provenance data; PLAN is copied into workout_session
-- only when execution actually starts.
CREATE TABLE workout_occurrence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_user_id INTEGER NOT NULL,
  client_user_id INTEGER NOT NULL,
  program_day_id INTEGER NOT NULL,
  calendar_date_key INTEGER NOT NULL,
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (start_minute + duration_minutes <= 1440),
  FOREIGN KEY (coach_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (program_day_id) REFERENCES program_day(id) ON DELETE RESTRICT,
  FOREIGN KEY (calendar_date_key) REFERENCES calendar_day(date_key) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

-- These are the hot paths for Today and cached calendar windows. The leading
-- actor id plus YYYYMMDD key lets D1 seek directly into the requested range.
CREATE INDEX idx_workout_occurrence_coach_date_start
  ON workout_occurrence(coach_user_id, calendar_date_key, start_minute, id)
  WHERE status <> 'cancelled';

CREATE INDEX idx_workout_occurrence_client_date_start
  ON workout_occurrence(client_user_id, calendar_date_key, start_minute, id)
  WHERE status <> 'cancelled';

CREATE INDEX idx_workout_occurrence_program_day
  ON workout_occurrence(program_day_id, calendar_date_key);

ALTER TABLE workout_session
  ADD COLUMN occurrence_id INTEGER
  REFERENCES workout_occurrence(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_workout_session_occurrence
  ON workout_session(occurrence_id)
  WHERE occurrence_id IS NOT NULL;

PRAGMA foreign_key_check;
