WITH sources AS (
  SELECT account.id AS app_user_id,
    CASE
      WHEN account.telegram_user_id = CAST(CAST(account.telegram_user_id AS INTEGER) AS TEXT)
        AND CAST(account.telegram_user_id AS INTEGER) BETWEEN 1 AND 4503599627370495
      THEN CAST(account.telegram_user_id AS INTEGER)
      ELSE 0
    END AS user_id,
    CASE
      WHEN length(account.username) BETWEEN 1 AND 32
        AND instr(account.username, char(0)) = 0
        AND account.username NOT GLOB '*[^A-Za-z0-9_]*'
      THEN lower(account.username)
    END AS username,
    count(*) OVER (PARTITION BY lower(account.username)) AS username_count
  FROM app_user AS account
), pending AS (
  SELECT source.*,
    EXISTS (SELECT 1 FROM password_credentials WHERE login = source.username) AS login_taken
  FROM sources AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM password_credentials
    WHERE app_user_id = source.app_user_id
  )
)
SELECT
  (SELECT count(*) FROM sources) AS total_telegram_accounts,
  count(*) AS pending_accounts,
  count(*) FILTER (WHERE user_id = 0) AS invalid_telegram_ids,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM password_credentials AS credentials WHERE credentials.user_id = pending.user_id
  )) AS user_id_conflicts,
  count(*) FILTER (WHERE username IS NULL) AS missing_or_invalid_logins,
  count(*) FILTER (WHERE username IS NOT NULL AND (username_count > 1 OR login_taken)) AS conflicting_logins,
  count(*) FILTER (WHERE username IS NOT NULL AND username_count = 1 AND NOT login_taken) AS available_logins
FROM pending;
