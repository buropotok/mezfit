PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS coach_client_invite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TEXT NOT NULL,
  accepted_by_user_id INTEGER,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (coach_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (accepted_by_user_id) REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS coach_client (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_user_id INTEGER NOT NULL,
  client_user_id INTEGER NOT NULL,
  invite_id INTEGER UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (coach_user_id <> client_user_id),
  UNIQUE (coach_user_id, client_user_id),
  FOREIGN KEY (coach_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (client_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES coach_client_invite(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_coach_client_coach ON coach_client(coach_user_id, status);
CREATE INDEX IF NOT EXISTS idx_coach_client_client ON coach_client(client_user_id, status);
CREATE INDEX IF NOT EXISTS idx_coach_invite_coach ON coach_client_invite(coach_user_id, created_at);
