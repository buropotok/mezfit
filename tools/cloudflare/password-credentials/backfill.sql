-- After the read-only preview has been reviewed, apply as one atomic statement.
-- An invalid Telegram ID maps to 0 and fails the CHECK, rolling back the statement.
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
INSERT INTO password_credentials (user_id, app_user_id, login)
SELECT user_id, app_user_id,
  CASE WHEN username_count = 1 AND NOT login_taken THEN username END
FROM pending;
