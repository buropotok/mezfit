PRAGMA foreign_keys = ON;

-- Import into a run-scoped staging batch first. The active catalogue is not
-- changed until the importer explicitly finalizes a complete 1,324-record run.
CREATE TABLE IF NOT EXISTS exercise_dataset_stage (
  import_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tracking_type TEXT NOT NULL,
  primary_muscle TEXT,
  equipment TEXT,
  category_code TEXT,
  equipment_code TEXT,
  media_key TEXT NOT NULL,
  reference_media_url TEXT NOT NULL,
  reference_order INTEGER NOT NULL,
  source_metadata_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (import_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_dataset_stage_import ON exercise_dataset_stage(import_id);
