CREATE TABLE migration_executions (
  job_id TEXT NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  processor_version TEXT NOT NULL,
  workflow_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  object_etag TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'unsupported')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result_key TEXT,
  result_sha256 TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, processor_version),
  CHECK (
    (state = 'succeeded' AND result_key IS NOT NULL AND length(result_sha256) = 64 AND result_sha256 IS NOT NULL AND error_code IS NULL)
    OR (state IN ('failed', 'unsupported') AND result_key IS NULL AND result_sha256 IS NULL AND error_code IS NOT NULL)
    OR (state IN ('queued', 'running') AND result_key IS NULL AND result_sha256 IS NULL AND error_code IS NULL)
  )
);
