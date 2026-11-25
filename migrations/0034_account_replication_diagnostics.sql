ALTER TABLE account_replication_outbox ADD COLUMN last_request_id TEXT;
ALTER TABLE account_replication_outbox ADD COLUMN last_http_status INTEGER;

CREATE TRIGGER account_replication_reset_diagnostics
AFTER UPDATE OF revision ON account_replication_outbox
WHEN NEW.revision != OLD.revision
BEGIN
  UPDATE account_replication_outbox
  SET last_request_id = NULL, last_http_status = NULL
  WHERE telegram_user_id = NEW.telegram_user_id;
END;
