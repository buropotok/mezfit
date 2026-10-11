-- Invitations are reusable per coach until expiry or explicit revocation.
-- A single invitation may now be referenced by multiple coach-client links.
-- Preserve stable relationship IDs, invite provenance and uniqueness per pair.
PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

ALTER TABLE coach_client_invite
  ADD COLUMN revoked_at TEXT;

CREATE TABLE coach_client_reusable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_user_id INTEGER NOT NULL,
  client_user_id INTEGER NOT NULL,
  invite_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (coach_user_id <> client_user_id),
  UNIQUE (coach_user_id, client_user_id),
  FOREIGN KEY (coach_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (client_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES coach_client_invite(id) ON DELETE SET NULL
);

INSERT INTO coach_client_reusable (
  id, coach_user_id, client_user_id, invite_id, status, created_at, updated_at
)
SELECT id, coach_user_id, client_user_id, invite_id, status, created_at, updated_at
FROM coach_client;

DROP TABLE coach_client;
ALTER TABLE coach_client_reusable RENAME TO coach_client;

CREATE INDEX idx_coach_client_coach ON coach_client(coach_user_id, status);
CREATE INDEX idx_coach_client_client ON coach_client(client_user_id, status);
CREATE INDEX idx_coach_client_invite ON coach_client(invite_id);
