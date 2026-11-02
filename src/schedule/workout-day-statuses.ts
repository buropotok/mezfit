import type { DatePickerDayStatus, DatePickerDayStatusEntry } from '../ui';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CalendarWorkoutSession } from '../data/cloud/adhoc-workouts';
import { calendarDate } from './calendar-time';

type Occurrence = Pick<CloudWorkoutOccurrenceRow,
  'id' | 'realmId' | 'athleteUserId' | 'coachUserId' | 'clientUserId'
  | 'entryKind' | 'inactive' | 'cancelledAt' | 'status' | 'workoutSessionId'
  | 'startsAtUtc' | 'durationMinutes'>;
type Draft = Pick<LocalWorkoutOccurrenceDraft,
  'targetOccurrenceId' | 'previouslyPublished' | 'realmId' | 'athleteUserId'
  | 'coachUserId' | 'clientUserId' | 'startsAtUtc' | 'durationMinutes'
  | 'executionStatus' | 'workoutSessionId'>;
type Session = Pick<CalendarWorkoutSession,
  'id' | 'occurrenceId' | 'realmId' | 'athleteUserId' | 'coachUserId'
  | 'clientUserId' | 'startedAt' | 'status'>;

type Booking = Pick<Occurrence, 'id' | 'realmId' | 'athleteUserId' | 'coachUserId'
  | 'clientUserId' | 'startsAtUtc' | 'durationMinutes' | 'status' | 'workoutSessionId'>;

const priority: Record<DatePickerDayStatus, number> = {
  completed: 0,
  scheduled: 1,
  missed: 2,
};

/** Display-only status. Neither the clock nor these markers mutate workout lifecycle. */
export function deriveWorkoutDayStatuses(
  occurrences: readonly Occurrence[],
  drafts: readonly Draft[],
  sessions: readonly Session[],
  athleteUserIds: readonly string[],
  now: number,
): { dayStatuses: DatePickerDayStatusEntry[]; nextChangeAt: number | null } {
  const athletes = new Set(athleteUserIds);
  if (!athletes.size) return { dayStatuses: [], nextChangeAt: null };

  const byDate = new Map<string, DatePickerDayStatus>();
  const sessionByOccurrence = new Map<string, Session>();
  for (const session of sessions) {
    if (session.occurrenceId && athletes.has(session.athleteUserId))
      sessionByOccurrence.set(session.occurrenceId, session);
  }

  let nextChangeAt: number | null = null;
  const represented = new Set<string>();
  const mark = (instant: string, status: DatePickerDayStatus) => {
    const time = Date.parse(instant);
    if (!Number.isFinite(time)) return;
    const date = calendarDate(new Date(time));
    const current = byDate.get(date);
    if (!current || priority[status] > priority[current]) byDate.set(date, status);
  };

  const addBooking = (row: Booking) => {
    if (!athletes.has(row.athleteUserId)) return;
    const start = Date.parse(row.startsAtUtc);
    const end = start + row.durationMinutes * 60_000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || row.durationMinutes < 0) return;
    represented.add(row.id);

    const candidate = sessionByOccurrence.get(row.id);
    const session = candidate && candidate.realmId === row.realmId
      && candidate.athleteUserId === row.athleteUserId
      && candidate.coachUserId === row.coachUserId
      && candidate.clientUserId === row.clientUserId
      && (!row.workoutSessionId || row.workoutSessionId === candidate.id)
      ? candidate : null;

    if (session?.status === 'completed' || row.status === 'completed') {
      mark(row.startsAtUtc, 'completed');
    } else if (session?.status === 'active' || row.status === 'in_progress' || row.workoutSessionId) {
      // An already started workout cannot become missed, even if it began late.
      mark(row.startsAtUtc, 'scheduled');
    } else if (now >= end) {
      mark(row.startsAtUtc, 'missed');
    } else {
      mark(row.startsAtUtc, 'scheduled');
      if (nextChangeAt === null || end < nextChangeAt) nextChangeAt = end;
    }
  };

  for (const row of occurrences) {
    if (row.entryKind === 'personal_event' || row.inactive || row.cancelledAt
      || row.status === 'cancelled') continue;
    addBooking(row);
  }
  // A previously published occurrence remains scheduled while a PLAN edit is an unpublished draft.
  for (const row of drafts) {
    if (!row.previouslyPublished || !row.targetOccurrenceId || represented.has(row.targetOccurrenceId)) continue;
    addBooking({ id: row.targetOccurrenceId, realmId: row.realmId,
      athleteUserId: row.athleteUserId, coachUserId: row.coachUserId, clientUserId: row.clientUserId,
      startsAtUtc: row.startsAtUtc, durationMinutes: row.durationMinutes,
      status: row.executionStatus ?? 'scheduled', workoutSessionId: row.workoutSessionId ?? null });
  }
  // Standalone execution has no scheduled occurrence; it belongs to the actual start date.
  for (const session of sessions) {
    if (session.occurrenceId || !athletes.has(session.athleteUserId)) continue;
    mark(session.startedAt, session.status === 'completed' ? 'completed' : 'scheduled');
  }

  return {
    dayStatuses: [...byDate].sort(([left], [right]) => left.localeCompare(right))
      .map(([date, status]) => ({ date, status })),
    nextChangeAt,
  };
}
