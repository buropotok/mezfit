PRAGMA foreign_keys = ON;

-- Import into staging first. The active catalogue is not changed until the
-- importer explicitly finalizes a complete 1,324-record batch.
CREATE TABLE IF NOT EXISTS exercise_dataset_stage (
  dataset_id TEXT PRIMARY KEY,
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
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
