CREATE TABLE migration_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  object_etag TEXT NOT NULL,
  object_size INTEGER NOT NULL CHECK (object_size >= 0),
  content_type TEXT,
  event_action TEXT NOT NULL,
  event_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('uploaded', 'rejected')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deliveries INTEGER NOT NULL DEFAULT 1 CHECK (deliveries >= 1)
);
