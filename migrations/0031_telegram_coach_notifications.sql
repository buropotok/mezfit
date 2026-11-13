CREATE TABLE telegram_coach_topics (
  coach_user_id TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  telegram_thread_id INTEGER,
  topic_title TEXT,
  claim_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (coach_user_id, topic_key)
);

CREATE TABLE telegram_discussion_delivery (
  message_id TEXT NOT NULL,
  realm_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, realm_id)
);

CREATE INDEX telegram_discussion_delivery_due
  ON telegram_discussion_delivery (next_attempt_at)
  WHERE status = 'pending';
