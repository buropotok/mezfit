-- The existing TEXT primary key keeps its historical name for rolling deploys.
-- Its value is the canonical user_id; for Telegram-first accounts it is unchanged.
ALTER TABLE account_replication_outbox ADD COLUMN full_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (full_snapshot IN (0, 1));
ALTER TABLE account_replication_outbox ADD COLUMN full_ack_revision INTEGER;

CREATE VIEW account_replication_source AS
SELECT COALESCE(CAST(c.user_id AS TEXT), u.telegram_user_id) AS replication_key,
  u.id, u.telegram_user_id, u.username, u.first_name, u.last_name, u.language_code, u.photo_url, u.is_premium,
  c.login, c.pass_hash, c.user_id IS NOT NULL AS credential_exists
FROM app_user AS u LEFT JOIN password_credentials AS c ON c.app_user_id = u.id
UNION ALL
SELECT CAST(user_id AS TEXT), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, login, pass_hash, 1
FROM password_credentials WHERE app_user_id IS NULL;

-- A Worker still using the legacy payload cannot acknowledge a full snapshot.
CREATE TRIGGER account_replication_require_full_ack
BEFORE UPDATE OF next_attempt_at ON account_replication_outbox
WHEN OLD.full_snapshot = 1 AND NEW.next_attempt_at IS NULL AND NEW.full_ack_revision IS NOT NEW.revision
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_REPLICATION_FULL_ACK_REQUIRED');
END;

DROP TRIGGER IF EXISTS account_replication_user_insert;
CREATE TRIGGER account_replication_user_insert
AFTER INSERT ON app_user
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  VALUES (COALESCE((SELECT CAST(user_id AS TEXT) FROM password_credentials WHERE app_user_id = NEW.id), NEW.telegram_user_id), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

DROP TRIGGER IF EXISTS account_replication_user_update;
CREATE TRIGGER account_replication_user_update
AFTER UPDATE OF username, first_name, last_name, language_code, photo_url, is_premium ON app_user
WHEN OLD.username IS NOT NEW.username OR OLD.first_name IS NOT NEW.first_name
  OR OLD.last_name IS NOT NEW.last_name OR OLD.language_code IS NOT NEW.language_code
  OR OLD.photo_url IS NOT NEW.photo_url OR OLD.is_premium IS NOT NEW.is_premium
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  VALUES (COALESCE((SELECT CAST(user_id AS TEXT) FROM password_credentials WHERE app_user_id = NEW.id), NEW.telegram_user_id), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

DROP TRIGGER IF EXISTS account_replication_user_delete;
CREATE TRIGGER account_replication_user_delete
AFTER DELETE ON app_user
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  VALUES (COALESCE((SELECT CAST(user_id AS TEXT) FROM password_credentials WHERE app_user_id = OLD.id), OLD.telegram_user_id), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

DROP TRIGGER account_replication_role_insert;
CREATE TRIGGER account_replication_role_insert
AFTER INSERT ON user_role
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  SELECT COALESCE((SELECT CAST(user_id AS TEXT) FROM password_credentials WHERE app_user_id = u.id), u.telegram_user_id), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0 FROM app_user AS u WHERE u.id IN (NEW.user_id)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

DROP TRIGGER account_replication_role_delete;
CREATE TRIGGER account_replication_role_delete
AFTER DELETE ON user_role
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  SELECT COALESCE((SELECT CAST(user_id AS TEXT) FROM password_credentials WHERE app_user_id = u.id), u.telegram_user_id), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0 FROM app_user AS u WHERE u.id IN (OLD.user_id)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

DROP TRIGGER account_replication_role_update;
CREATE TRIGGER account_replication_role_update
AFTER UPDATE OF user_id, role ON user_role
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  SELECT COALESCE((SELECT CAST(user_id AS TEXT) FROM password_credentials WHERE app_user_id = u.id), u.telegram_user_id), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0 FROM app_user AS u WHERE u.id IN (OLD.user_id, NEW.user_id)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

CREATE TRIGGER account_replication_credentials_insert
AFTER INSERT ON password_credentials
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  VALUES (CAST(NEW.user_id AS TEXT), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  SELECT u.telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1
  FROM app_user AS u WHERE u.id = NEW.app_user_id AND u.telegram_user_id <> CAST(NEW.user_id AS TEXT)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

CREATE TRIGGER account_replication_credentials_update
AFTER UPDATE ON password_credentials
WHEN OLD.app_user_id IS NOT NEW.app_user_id OR OLD.login IS NOT NEW.login OR OLD.pass_hash IS NOT NEW.pass_hash
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  VALUES (CAST(NEW.user_id AS TEXT), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  SELECT u.telegram_user_id, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1
  FROM app_user AS u WHERE u.id = NEW.app_user_id AND u.telegram_user_id <> CAST(NEW.user_id AS TEXT)
    AND OLD.app_user_id IS NOT NEW.app_user_id
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;

-- A linked password-first identity needs an explicit account deletion protocol.
-- Revoke its password by updating pass_hash, without reassigning its Telegram profile.
CREATE TRIGGER account_replication_keep_linked_identity
BEFORE DELETE ON password_credentials
WHEN OLD.app_user_id IS NOT NULL AND OLD.user_id >= 4503599627370496
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_REPLICATION_LINKED_IDENTITY_DELETE_UNSUPPORTED');
END;

CREATE TRIGGER account_replication_credentials_delete
AFTER DELETE ON password_credentials
BEGIN
  INSERT INTO account_replication_outbox (telegram_user_id, revision, next_attempt_at, full_snapshot)
  VALUES (CAST(OLD.user_id AS TEXT), 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1)
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    revision = revision + 1, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL,
    full_snapshot = MAX(full_snapshot, excluded.full_snapshot);
END;
