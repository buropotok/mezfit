CREATE TABLE password_credentials (
  -- Preserve the supplied storage class so SQLite cannot round/coerce numeric text.
  user_id ANY PRIMARY KEY NOT NULL
    CHECK (typeof(user_id) = 'integer' AND user_id BETWEEN 1 AND 9007199254740991),
  app_user_id INTEGER UNIQUE REFERENCES app_user(id) ON DELETE RESTRICT,
  login TEXT COLLATE NOCASE UNIQUE
    CHECK (length(login) BETWEEN 1 AND 32 AND instr(login, char(0)) = 0
      AND login NOT GLOB '*[^a-z0-9_]*'),
  pass_hash TEXT CHECK (length(pass_hash) > 0),
  CHECK (app_user_id IS NOT NULL OR
    (user_id >= 4503599627370496 AND login IS NOT NULL AND pass_hash IS NOT NULL))
) STRICT;

CREATE TRIGGER password_credentials_keep_user_id
BEFORE UPDATE ON password_credentials
WHEN NEW.user_id IS NOT OLD.user_id
BEGIN
  SELECT RAISE(ABORT, 'password_credentials user_id is immutable');
END;

CREATE TRIGGER password_credentials_keep_app_user_id
BEFORE UPDATE ON password_credentials
WHEN OLD.app_user_id IS NOT NULL AND NEW.app_user_id IS NOT OLD.app_user_id
BEGIN
  SELECT RAISE(ABORT, 'password_credentials Telegram link is already set');
END;
