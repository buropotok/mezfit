-- D1 keeps foreign-key enforcement enabled during migrations. Defer checks until
-- the replacement table has been renamed back to training_plan.
PRAGMA defer_foreign_keys = ON;

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
SELECT id, user_id, name, created_by_user_id, created_at, updated_at FROM training_plan;

DROP TABLE training_plan;
ALTER TABLE training_plan_next RENAME TO training_plan;

CREATE INDEX idx_training_plan_user_id ON training_plan(user_id);
CREATE INDEX idx_training_plan_created_by_user_id ON training_plan(created_by_user_id);

PRAGMA defer_foreign_keys = OFF;
