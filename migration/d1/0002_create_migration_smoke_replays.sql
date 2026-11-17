CREATE TABLE migration_smoke_replays (
  replay_id TEXT PRIMARY KEY NOT NULL,
  object_key TEXT NOT NULL UNIQUE REFERENCES migration_jobs(object_key),
  observed_at TEXT NOT NULL
);
