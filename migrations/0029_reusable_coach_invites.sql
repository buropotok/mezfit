PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Invitation links are reusable until expiry or explicit revocation.
-- Legacy accepted_at / accepted_by_user_id are retained as historical data,
-- but no longer gate or record successful acceptance for new links.
ALTER TABLE coach_client_invite ADD COLUMN revoked_at TEXT;

-- Preserve the invite provenance of every coach-client relationship while
-- allowing many distinct clients to accept the same invitation link.
-- The pair remains unique; changing that invariant would be incorrect.
CREATE TABLE coach_client_next (
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

INSERT INTO coach_client_next (
  id, coach_user_id, client_user_id, invite_id, status, created_at, updated_at
)
SELECT id, coach_user_id, client_user_id, invite_id, status, created_at, updated_at
FROM coach_client;

DROP TABLE coach_client;
ALTER TABLE coach_client_next RENAME TO coach_client;

CREATE INDEX idx_coach_client_coach ON coach_client(coach_user_id, status);
CREATE INDEX idx_coach_client_client ON coach_client(client_user_id, status);
CREATE INDEX idx_coach_client_invite ON coach_client(invite_id);
