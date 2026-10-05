export type ScheduleRole = 'coach' | 'client';
export type WorkoutOccurrenceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface CalendarDayValue {
  dateKey: number;
  localDate: string;
  year: number;
  month: number;
  day: number;
  isoWeekYear: number;
  isoWeek: number;
  weekday: number;
}

export interface SchedulePersonSummary {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface ScheduleOccurrence {
  id: number;
  calendarDate: string;
  dateKey: number;
  startMinute: number;
  durationMinutes: number;
  status: Exclude<WorkoutOccurrenceStatus, 'cancelled'>;
  program: { id: number; name: string };
  phase: { id: number; name: string };
  day: { id: number; name: string; position: number };
  coach: SchedulePersonSummary;
  client: SchedulePersonSummary;
  sessionId: number | null;
}

interface OccurrenceRow {
  id: number;
  calendar_date: string;
  calendar_date_key: number;
  start_minute: number;
  duration_minutes: number;
  status: Exclude<WorkoutOccurrenceStatus, 'cancelled'>;
  program_id: number;
  program_name: string;
  phase_id: number;
  phase_name: string;
  day_id: number;
  day_name: string;
  day_position: number;
  coach_id: number;
  coach_first_name: string;
  coach_last_name: string | null;
  coach_username: string | null;
  coach_photo_url: string | null;
  client_id: number;
  client_first_name: string;
  client_last_name: string | null;
  client_username: string | null;
  client_photo_url: string | null;
  session_id: number | null;
}

interface OccurrenceMutationRow {
  id: number;
  coach_user_id: number;
  client_user_id: number;
  program_day_id: number;
  status: WorkoutOccurrenceStatus;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoWeekParts(date: Date): { year: number; week: number } {
  const thursday = new Date(date.getTime());
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - weekday + 3);

  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);

  return {
    year: isoYear,
    week: 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS)),
  };
}

export function parseCalendarDay(value: string): CalendarDayValue | null {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  const isoWeek = isoWeekParts(date);
  return {
    dateKey: year * 10000 + month * 100 + day,
    localDate: value,
    year,
    month,
    day,
    isoWeekYear: isoWeek.year,
    isoWeek: isoWeek.week,
    weekday: ((date.getUTCDay() + 6) % 7) + 1,
  };
}

export function dayDistance(from: CalendarDayValue, to: CalendarDayValue): number {
  const fromDate = Date.UTC(from.year, from.month - 1, from.day);
  const toDate = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toDate - fromDate) / DAY_MS);
}

function mapOccurrence(row: OccurrenceRow): ScheduleOccurrence {
  return {
    id: row.id,
    calendarDate: row.calendar_date,
    dateKey: row.calendar_date_key,
    startMinute: row.start_minute,
    durationMinutes: row.duration_minutes,
    status: row.status,
    program: { id: row.program_id, name: row.program_name },
    phase: { id: row.phase_id, name: row.phase_name },
    day: { id: row.day_id, name: row.day_name, position: row.day_position },
    coach: {
      id: row.coach_id,
      firstName: row.coach_first_name,
      lastName: row.coach_last_name,
      username: row.coach_username,
      photoUrl: row.coach_photo_url,
    },
    client: {
      id: row.client_id,
      firstName: row.client_first_name,
      lastName: row.client_last_name,
      username: row.client_username,
      photoUrl: row.client_photo_url,
    },
    sessionId: row.session_id,
  };
}

const occurrenceProjection = `
  SELECT
    occurrence.id,
    day.local_date AS calendar_date,
    occurrence.calendar_date_key,
    occurrence.start_minute,
    occurrence.duration_minutes,
    occurrence.status,
    plan.id AS program_id,
    plan.name AS program_name,
    phase.id AS phase_id,
    phase.name AS phase_name,
    program_day.id AS day_id,
    program_day.name AS day_name,
    program_day.position AS day_position,
    coach.id AS coach_id,
    coach.first_name AS coach_first_name,
    coach.last_name AS coach_last_name,
    coach.username AS coach_username,
    coach.photo_url AS coach_photo_url,
    client.id AS client_id,
    client.first_name AS client_first_name,
    client.last_name AS client_last_name,
    client.username AS client_username,
    client.photo_url AS client_photo_url,
    session.id AS session_id
  FROM workout_occurrence occurrence
  JOIN calendar_day day ON day.date_key = occurrence.calendar_date_key
  JOIN program_day ON program_day.id = occurrence.program_day_id
  JOIN program_phase phase ON phase.id = program_day.program_phase_id
  JOIN training_plan plan ON plan.id = phase.training_plan_id
  JOIN app_user coach ON coach.id = occurrence.coach_user_id
  JOIN app_user client ON client.id = occurrence.client_user_id
  LEFT JOIN workout_session session ON session.occurrence_id = occurrence.id
`;

export async function listScheduleOccurrences(
  db: D1Database,
  actorUserId: number,
  role: ScheduleRole,
  fromDateKey: number,
  toDateKey: number,
): Promise<ScheduleOccurrence[]> {
  const roleFilter = role === 'coach'
    ? `
      JOIN coach_client relationship
        ON relationship.coach_user_id = occurrence.coach_user_id
       AND relationship.client_user_id = occurrence.client_user_id
       AND relationship.status = 'active'
      WHERE occurrence.coach_user_id = ?
    `
    : 'WHERE occurrence.client_user_id = ?';

  const result = await db
    .prepare(`
      ${occurrenceProjection}
      ${roleFilter}
        AND occurrence.calendar_date_key BETWEEN ? AND ?
        AND occurrence.status <> 'cancelled'
      ORDER BY occurrence.calendar_date_key, occurrence.start_minute, occurrence.id
    `)
    .bind(actorUserId, fromDateKey, toDateKey)
    .all<OccurrenceRow>();

  return result.results.map(mapOccurrence);
}

async function occurrenceForActor(
  db: D1Database,
  occurrenceId: number,
  coachUserId: number,
): Promise<OccurrenceMutationRow | null> {
  return db
    .prepare(`
      SELECT
        occurrence.id,
        occurrence.coach_user_id,
        occurrence.client_user_id,
        occurrence.program_day_id,
        occurrence.status
      FROM workout_occurrence occurrence
      JOIN coach_client relationship
        ON relationship.coach_user_id = occurrence.coach_user_id
       AND relationship.client_user_id = occurrence.client_user_id
       AND relationship.status = 'active'
      WHERE occurrence.id = ?
        AND occurrence.coach_user_id = ?
      LIMIT 1
    `)
    .bind(occurrenceId, coachUserId)
    .first<OccurrenceMutationRow>();
}

async function occurrenceById(
  db: D1Database,
  occurrenceId: number,
  coachUserId: number,
): Promise<ScheduleOccurrence | null> {
  const row = await db
    .prepare(`
      ${occurrenceProjection}
      JOIN coach_client relationship
        ON relationship.coach_user_id = occurrence.coach_user_id
       AND relationship.client_user_id = occurrence.client_user_id
       AND relationship.status = 'active'
      WHERE occurrence.id = ?
        AND occurrence.coach_user_id = ?
        AND occurrence.status <> 'cancelled'
      LIMIT 1
    `)
    .bind(occurrenceId, coachUserId)
    .first<OccurrenceRow>();

  return row ? mapOccurrence(row) : null;
}

async function coachOwnsProgramDay(
  db: D1Database,
  coachUserId: number,
  clientUserId: number,
  programDayId: number,
): Promise<boolean> {
  const row = await db
    .prepare(`
      SELECT program_day.id
      FROM program_day
      JOIN program_phase phase ON phase.id = program_day.program_phase_id
      JOIN training_plan plan ON plan.id = phase.training_plan_id
      JOIN coach_client relationship
        ON relationship.coach_user_id = ?
       AND relationship.client_user_id = ?
       AND relationship.status = 'active'
      WHERE program_day.id = ?
        AND program_day.status = 'active'
        AND plan.user_id = ?
        AND COALESCE(plan.owner_coach_user_id, plan.created_by_user_id) = ?
      LIMIT 1
    `)
    .bind(coachUserId, clientUserId, programDayId, clientUserId, coachUserId)
    .first<{ id: number }>();

  return Boolean(row);
}

function calendarInsert(db: D1Database, day: CalendarDayValue): D1PreparedStatement {
  return db
    .prepare(`
      INSERT OR IGNORE INTO calendar_day (
        date_key, local_date, year, month, day, iso_week_year, iso_week, weekday
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      day.dateKey,
      day.localDate,
      day.year,
      day.month,
      day.day,
      day.isoWeekYear,
      day.isoWeek,
      day.weekday,
    );
}

export async function createScheduleOccurrence(
  db: D1Database,
  coachUserId: number,
  input: {
    clientUserId: number;
    programDayId: number;
    day: CalendarDayValue;
    startMinute: number;
    durationMinutes: number;
  },
): Promise<{ kind: 'ok'; occurrence: ScheduleOccurrence } | { kind: 'invalid_target' }> {
  if (!(await coachOwnsProgramDay(db, coachUserId, input.clientUserId, input.programDayId))) {
    return { kind: 'invalid_target' };
  }

  const results = await db.batch([
    calendarInsert(db, input.day),
    db.prepare(`
      INSERT INTO workout_occurrence (
        coach_user_id,
        client_user_id,
        program_day_id,
        calendar_date_key,
        start_minute,
        duration_minutes,
        status,
        created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)
      RETURNING id
    `).bind(
      coachUserId,
      input.clientUserId,
      input.programDayId,
      input.day.dateKey,
      input.startMinute,
      input.durationMinutes,
      coachUserId,
    ),
  ]);

  const inserted = results[1]?.results[0] as { id?: unknown } | undefined;
  if (!inserted || typeof inserted.id !== 'number') throw new Error('FAILED_TO_CREATE_WORKOUT_OCCURRENCE');

  const occurrence = await occurrenceById(db, inserted.id, coachUserId);
  if (!occurrence) throw new Error('CREATED_WORKOUT_OCCURRENCE_MISSING');
  return { kind: 'ok', occurrence };
}

export async function rescheduleOccurrence(
  db: D1Database,
  coachUserId: number,
  occurrenceId: number,
  day: CalendarDayValue,
  startMinute: number,
  durationMinutes: number,
): Promise<{ kind: 'ok'; occurrence: ScheduleOccurrence } | { kind: 'not_found' } | { kind: 'locked' }> {
  const existing = await occurrenceForActor(db, occurrenceId, coachUserId);
  if (!existing) return { kind: 'not_found' };
  if (existing.status !== 'scheduled') return { kind: 'locked' };

  const results = await db.batch([
    calendarInsert(db, day),
    db.prepare(`
      UPDATE workout_occurrence
      SET calendar_date_key = ?,
          start_minute = ?,
          duration_minutes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND coach_user_id = ?
        AND status = 'scheduled'
    `).bind(day.dateKey, startMinute, durationMinutes, occurrenceId, coachUserId),
  ]);
  if ((results[1]?.meta?.changes ?? 0) === 0) return { kind: 'locked' };

  const occurrence = await occurrenceById(db, occurrenceId, coachUserId);
  if (!occurrence) throw new Error('RESCHEDULED_WORKOUT_OCCURRENCE_MISSING');
  return { kind: 'ok', occurrence };
}

export async function cancelOccurrence(
  db: D1Database,
  coachUserId: number,
  occurrenceId: number,
): Promise<'ok' | 'not_found' | 'locked'> {
  const existing = await occurrenceForActor(db, occurrenceId, coachUserId);
  if (!existing) return 'not_found';
  if (existing.status !== 'scheduled') return 'locked';

  const result = await db
    .prepare(`
      UPDATE workout_occurrence
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND coach_user_id = ? AND status = 'scheduled'
    `)
    .bind(occurrenceId, coachUserId)
    .run();

  return (result.meta?.changes ?? 0) > 0 ? 'ok' : 'locked';
}
