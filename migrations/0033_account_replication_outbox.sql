-- Keep delivered rows so an account's next revision never starts over.
CREATE TABLE account_replication_outbox (
  telegram_user_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER,
  last_error TEXT
);

CREATE INDEX idx_account_replication_due
  ON account_replication_outbox (next_attempt_at, telegram_user_id)
  WHERE next_attempt_at IS NOT NULL;

CREATE TRIGGER account_replication_user_insert
AFTER INSERT ON app_user
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at)
  VALUES (NEW.telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1,
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    last_error = NULL;
END;

CREATE TRIGGER account_replication_user_update
AFTER UPDATE OF username, first_name, last_name, language_code, photo_url, is_premium ON app_user
WHEN OLD.username IS NOT NEW.username
  OR OLD.first_name IS NOT NEW.first_name
  OR OLD.last_name IS NOT NEW.last_name
  OR OLD.language_code IS NOT NEW.language_code
  OR OLD.photo_url IS NOT NEW.photo_url
  OR OLD.is_premium IS NOT NEW.is_premium
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at)
  VALUES (NEW.telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1,
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    last_error = NULL;
END;

CREATE TRIGGER account_replication_role_insert
AFTER INSERT ON user_role
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at)
  SELECT telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM app_user WHERE id = NEW.user_id
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1,
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    last_error = NULL;
END;

CREATE TRIGGER account_replication_role_delete
AFTER DELETE ON user_role
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at)
  SELECT telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM app_user WHERE id = OLD.user_id
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1,
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    last_error = NULL;
END;

CREATE TRIGGER account_replication_role_update
AFTER UPDATE OF user_id, role ON user_role
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at)
  SELECT telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM app_user WHERE id IN (OLD.user_id, NEW.user_id)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1,
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    last_error = NULL;
END;
