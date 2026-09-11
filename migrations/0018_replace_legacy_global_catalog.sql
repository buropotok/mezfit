PRAGMA foreign_keys = ON;

-- The 1,324-record GitHub dataset is the canonical bundled Mezfit catalogue.
-- Keep legacy rows for historical FK integrity, but remove them from all active
-- catalogue queries. The importer activates only github_exercises_dataset rows.
UPDATE exercise_definition
SET is_archived = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE scope = 'global'
  AND COALESCE(reference_source, '') <> 'github_exercises_dataset';
