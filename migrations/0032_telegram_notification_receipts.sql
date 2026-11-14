CREATE TABLE telegram_notification_receipts (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX telegram_notification_receipts_expiry
  ON telegram_notification_receipts (expires_at);
