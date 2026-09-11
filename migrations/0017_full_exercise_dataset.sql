PRAGMA foreign_keys = ON;

ALTER TABLE exercise_definition ADD COLUMN source_metadata_json TEXT;

-- The upstream dataset is keyed by source id, not display name. Keeping the
-- old global-name uniqueness would silently discard valid source records.
DROP INDEX IF EXISTS uq_exercise_global_name;

CREATE INDEX IF NOT EXISTS idx_exercise_global_name
  ON exercise_definition(lower(name)) WHERE scope = 'global';
