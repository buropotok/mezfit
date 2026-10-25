-- Add specialized set technique without rewriting historical deprecated set_label data.
-- New clients use set_type exclusively; null denotes an ordinary approach.
ALTER TABLE session_set ADD COLUMN set_type TEXT
  CHECK (set_type IS NULL OR set_type IN (
    'dropset', 'isometrics', 'cluster', 'rest_pause', 'tempo_superset', 'partial_reps'
  ));
