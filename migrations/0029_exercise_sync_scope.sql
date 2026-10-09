ALTER TABLE exercise_definition ADD COLUMN sync_id TEXT;

UPDATE exercise_definition
SET sync_id = CAST(id AS TEXT)
WHERE sync_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_definition_sync_id
  ON exercise_definition(sync_id)
  WHERE sync_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sync_scope_revision (
  scope_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_request (
  request_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  response_revision INTEGER NOT NULL CHECK (response_revision >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_request_scope_created
  ON sync_request(scope_key, created_at);

CREATE TABLE IF NOT EXISTS sync_cas_assert (
  request_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
