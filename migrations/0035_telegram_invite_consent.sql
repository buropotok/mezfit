CREATE TABLE telegram_invite_consent (
  id TEXT PRIMARY KEY NOT NULL,
  telegram_user_id TEXT NOT NULL,
  start_message_id INTEGER NOT NULL,
  invite_id INTEGER NOT NULL REFERENCES coach_client_invite(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'offered' CHECK (state IN ('offered', 'cancelled', 'accepting', 'accepted')),
  expires_at INTEGER NOT NULL,
  claim_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE (telegram_user_id, start_message_id)
);

CREATE INDEX idx_telegram_invite_consent_expiry ON telegram_invite_consent (expires_at);
