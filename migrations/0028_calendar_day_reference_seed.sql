PRAGMA foreign_keys = ON;

-- calendar_day is a read-only calendar dimension. Populate a bounded reference
-- range once; runtime schedule writes must only reference existing rows.
WITH RECURSIVE calendar_dates(local_date) AS (
  SELECT DATE('2000-01-01')
  UNION ALL
  SELECT DATE(local_date, '+1 day')
  FROM calendar_dates
  WHERE local_date < DATE('2100-12-31')
),
calendar_parts AS (
  SELECT
    local_date,
    CAST(STRFTIME('%Y%m%d', local_date) AS INTEGER) AS date_key,
    CAST(STRFTIME('%Y', local_date) AS INTEGER) AS year,
    CAST(STRFTIME('%m', local_date) AS INTEGER) AS month,
    CAST(STRFTIME('%d', local_date) AS INTEGER) AS day,
    ((CAST(STRFTIME('%w', local_date) AS INTEGER) + 6) % 7) + 1 AS weekday
  FROM calendar_dates
),
calendar_iso AS (
  SELECT
    *,
    DATE(local_date, PRINTF('%+d day', 4 - weekday)) AS iso_thursday
  FROM calendar_parts
)
INSERT OR IGNORE INTO calendar_day (
  date_key,
  local_date,
  year,
  month,
  day,
  iso_week_year,
  iso_week,
  weekday
)
SELECT
  date_key,
  local_date,
  year,
  month,
  day,
  CAST(STRFTIME('%Y', iso_thursday) AS INTEGER),
  CAST(((CAST(STRFTIME('%j', iso_thursday) AS INTEGER) - 1) / 7) + 1 AS INTEGER),
  weekday
FROM calendar_iso;

-- Stable mock data for end-to-end schedule verification.
-- It is deliberately isolated in a named mock plan and only materializes when
-- both named users and their active coach/client relationship already exist.
INSERT INTO training_plan (
  user_id,
  name,
  created_by_user_id,
  owner_coach_user_id,
  position
)
SELECT
  client.id,
  '[MOCK] Расписание',
  coach.id,
  coach.id,
  COALESCE((
    SELECT MAX(existing.position) + 1
    FROM training_plan existing
    WHERE existing.user_id = client.id
  ), 0)
FROM (
  SELECT id
  FROM app_user
  WHERE username = 'sokolag'
  ORDER BY id DESC
  LIMIT 1
) client
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'goldalex_1'
  ORDER BY id DESC
  LIMIT 1
) coach
  ON 1 = 1
JOIN coach_client relationship
  ON relationship.coach_user_id = coach.id
 AND relationship.client_user_id = client.id
 AND relationship.status = 'active'
WHERE NOT EXISTS (
    SELECT 1
    FROM training_plan existing
    WHERE existing.user_id = client.id
      AND existing.owner_coach_user_id = coach.id
      AND existing.name = '[MOCK] Расписание'
  );

INSERT INTO program_phase (
  training_plan_id,
  name,
  position,
  status,
  created_by_user_id,
  started_at
)
SELECT
  plan.id,
  '[MOCK] Неделя',
  0,
  'active',
  coach.id,
  CURRENT_TIMESTAMP
FROM training_plan plan
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'sokolag'
  ORDER BY id DESC
  LIMIT 1
) client
  ON client.id = plan.user_id
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'goldalex_1'
  ORDER BY id DESC
  LIMIT 1
) coach
  ON coach.id = plan.owner_coach_user_id
WHERE plan.name = '[MOCK] Расписание'
  AND NOT EXISTS (
    SELECT 1
    FROM program_phase existing
    WHERE existing.training_plan_id = plan.id
  );

INSERT INTO program_day (
  program_phase_id,
  name,
  position,
  created_by_user_id,
  status
)
SELECT phase.id, seed.name, seed.position, coach.id, 'active'
FROM program_phase phase
JOIN training_plan plan
  ON plan.id = phase.training_plan_id
 AND plan.name = '[MOCK] Расписание'
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'sokolag'
  ORDER BY id DESC
  LIMIT 1
) client
  ON client.id = plan.user_id
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'goldalex_1'
  ORDER BY id DESC
  LIMIT 1
) coach
  ON coach.id = plan.owner_coach_user_id
JOIN (
  SELECT 0 AS position, '[MOCK] Верх тела' AS name
  UNION ALL
  SELECT 1, '[MOCK] Ноги'
  UNION ALL
  SELECT 2, '[MOCK] Спина'
) seed
WHERE phase.name = '[MOCK] Неделя'
  AND NOT EXISTS (
    SELECT 1
    FROM program_day existing
    WHERE existing.program_phase_id = phase.id
      AND existing.position = seed.position
      AND existing.status = 'active'
  );

-- Several fixed events around the feature rollout date. calendar_date_key is
-- selected from the reference table, never computed/inserted ad hoc here.
INSERT INTO workout_occurrence (
  coach_user_id,
  client_user_id,
  program_day_id,
  calendar_date_key,
  start_minute,
  duration_minutes,
  status,
  created_by_user_id
)
SELECT
  coach.id,
  client.id,
  day.id,
  calendar.date_key,
  seed.start_minute,
  seed.duration_minutes,
  'scheduled',
  coach.id
FROM (
  SELECT '2026-10-05' AS local_date, 0 AS day_position, 540 AS start_minute, 60 AS duration_minutes
  UNION ALL
  SELECT '2026-10-05', 1, 810, 75
  UNION ALL
  SELECT '2026-10-05', 2, 1080, 90
  UNION ALL
  SELECT '2026-10-06', 0, 660, 60
  UNION ALL
  SELECT '2026-10-07', 1, 1170, 60
) seed
JOIN calendar_day calendar
  ON calendar.local_date = seed.local_date
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'sokolag'
  ORDER BY id DESC
  LIMIT 1
) client
  ON 1 = 1
JOIN (
  SELECT id
  FROM app_user
  WHERE username = 'goldalex_1'
  ORDER BY id DESC
  LIMIT 1
) coach
  ON 1 = 1
JOIN coach_client relationship
  ON relationship.coach_user_id = coach.id
 AND relationship.client_user_id = client.id
 AND relationship.status = 'active'
JOIN training_plan plan
  ON plan.user_id = client.id
 AND plan.owner_coach_user_id = coach.id
 AND plan.name = '[MOCK] Расписание'
JOIN program_phase phase
  ON phase.training_plan_id = plan.id
 AND phase.name = '[MOCK] Неделя'
 AND phase.status = 'active'
JOIN program_day day
  ON day.program_phase_id = phase.id
 AND day.position = seed.day_position
 AND day.status = 'active'
WHERE NOT EXISTS (
  SELECT 1
  FROM workout_occurrence existing
  WHERE existing.coach_user_id = coach.id
    AND existing.client_user_id = client.id
    AND existing.program_day_id = day.id
    AND existing.calendar_date_key = calendar.date_key
    AND existing.start_minute = seed.start_minute
    AND existing.status <> 'cancelled'
);

PRAGMA foreign_key_check;
