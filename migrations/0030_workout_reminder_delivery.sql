-- Technical reminder idempotency/delivery journal only; workout data remains in Dexie Cloud.
-- At most three attempts per occurrence/start/recipient/kind. No PLAN or FACT is copied.
CREATE TABLE workout_reminder_delivery (
  id TEXT PRIMARY KEY NOT NULL,
  occurrence_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('client', 'coached', 'own')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'blocked')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
  attempted_at TEXT,
  next_attempt_at TEXT NOT NULL,
  sent_at TEXT,
  telegram_message_id INTEGER,
  last_error_code TEXT
);

CREATE INDEX idx_workout_reminder_delivery_status ON workout_reminder_delivery (status, next_attempt_at);
