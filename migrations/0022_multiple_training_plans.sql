PRAGMA defer_foreign_keys = ON;

-- Product contract: a coach or client may own more than one program.
-- Rebuild the parent table to remove the original UNIQUE(user_id) constraint
-- while preserving stable plan ids referenced by program_phase.
CREATE TABLE training_plan_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

INSERT INTO training_plan_next (id, user_id, name, created_by_user_id, created_at, updated_at)
SELECT id, user_id, name, created_by_user_id, created_at, updated_at
FROM training_plan;

DROP TABLE training_plan;
ALTER TABLE training_plan_next RENAME TO training_plan;

CREATE INDEX idx_training_plan_user_updated
  ON training_plan(user_id, updated_at DESC, id DESC);
