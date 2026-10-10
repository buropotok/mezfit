CREATE TABLE IF NOT EXISTS sync_scope_revision (
  scope_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_request (
  request_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  base_server_revision INTEGER NOT NULL CHECK (base_server_revision >= 0),
  payload_fingerprint TEXT NOT NULL,
  response_revision INTEGER NOT NULL CHECK (response_revision >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_request_scope_revision
  ON sync_request(scope_key, response_revision);

CREATE TABLE IF NOT EXISTS sync_cas_assert (
  request_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
