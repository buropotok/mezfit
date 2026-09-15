PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Rename the historical relationship state from "archived" to "inactive"
-- while preserving relationship IDs, invite provenance, timestamps, and the
-- existing one-row-per-coach/client-pair invariant.
CREATE TABLE coach_client_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_user_id INTEGER NOT NULL,
  client_user_id INTEGER NOT NULL,
  invite_id INTEGER UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (coach_user_id <> client_user_id),
  UNIQUE (coach_user_id, client_user_id),
  FOREIGN KEY (coach_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (client_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES coach_client_invite(id) ON DELETE SET NULL
);

INSERT INTO coach_client_next (
  id,
  coach_user_id,
  client_user_id,
  invite_id,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  coach_user_id,
  client_user_id,
  invite_id,
  CASE status
    WHEN 'archived' THEN 'inactive'
    ELSE status
  END,
  created_at,
  updated_at
FROM coach_client;

DROP TABLE coach_client;
ALTER TABLE coach_client_next RENAME TO coach_client;

CREATE INDEX idx_coach_client_coach ON coach_client(coach_user_id, status);
CREATE INDEX idx_coach_client_client ON coach_client(client_user_id, status);

-- A plan has an explicit coach owner only when the historical creator has a
-- real coach/client relationship with the plan's user. NULL intentionally
-- represents a client-owned/personal plan or legacy data whose coach ownership
-- cannot be proven from persisted relationships.
ALTER TABLE training_plan
  ADD COLUMN owner_coach_user_id INTEGER
  REFERENCES app_user(id) ON DELETE RESTRICT;

UPDATE training_plan AS plan
SET owner_coach_user_id = plan.created_by_user_id
WHERE EXISTS (
  SELECT 1
  FROM coach_client AS relationship
  WHERE relationship.coach_user_id = plan.created_by_user_id
    AND relationship.client_user_id = plan.user_id
);

CREATE INDEX idx_training_plan_owner_user_position
  ON training_plan(owner_coach_user_id, user_id, position);
