import { describe, expect, it } from 'vitest';
import { deriveWorkoutDayStatuses } from './workout-day-statuses';
import { calendarDate } from './calendar-time';

type Occurrence = Parameters<typeof deriveWorkoutDayStatuses>[0][number];
type Draft = Parameters<typeof deriveWorkoutDayStatuses>[1][number];
type Session = Parameters<typeof deriveWorkoutDayStatuses>[2][number];

const at = (value: string) => Date.parse(value);
const scheduled = (overrides: Partial<Occurrence> = {}): Occurrence => ({
  id: 'occ-1', realmId: 'relationship', athleteUserId: 'tg:202',
  coachUserId: 'tg:101', clientUserId: 'tg:202',
  startsAtUtc: '2026-10-20T18:00:00.000Z', durationMinutes: 60,
  status: 'scheduled', workoutSessionId: null,
  ...overrides,
});
const execution = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1', occurrenceId: 'occ-1', realmId: 'relationship',
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
  startedAt: '2026-10-20T19:15:00.000Z', status: 'active',
  ...overrides,
});
const draft = (overrides: Partial<Draft> = {}): Draft => ({
  targetOccurrenceId: 'occ-1', previouslyPublished: true, realmId: 'relationship',
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
  startsAtUtc: '2026-10-20T18:00:00.000Z', durationMinutes: 60,
  ...overrides,
});
const derive = (
  occurrences: Occurrence[], now: number, sessions: Session[] = [],
  drafts: Draft[] = [], athletes = ['tg:202'],
) => deriveWorkoutDayStatuses(occurrences, drafts, sessions, athletes, now);

describe('workout calendar day status projection', () => {
  const start = at('2026-10-20T18:00:00.000Z');
  const end = at('2026-10-20T19:00:00.000Z');
  const localDay = calendarDate(new Date(start));

  it('remains scheduled while late and becomes missed only at the planned end', () => {
    expect(derive([scheduled()], start - 1)).toEqual({
      dayStatuses: [{ date: localDay, status: 'scheduled' }], nextChangeAt: end,
    });
    expect(derive([scheduled()], start + 60_000).dayStatuses).toEqual([
      { date: localDay, status: 'scheduled' },
    ]);
    expect(derive([scheduled()], end - 1).nextChangeAt).toBe(end);
    expect(derive([scheduled()], end)).toEqual({
      dayStatuses: [{ date: localDay, status: 'missed' }], nextChangeAt: null,
    });
  });

  it('never counts a started workout as missed, including a late start and stale occurrence', () => {
    const row = scheduled({ workoutSessionId: 'session-1', status: 'in_progress' });
    expect(derive([row], end + 60_000, [execution()]).dayStatuses).toEqual([
      { date: localDay, status: 'scheduled' },
    ]);
    expect(derive([row], end + 60_000).dayStatuses).toEqual([
      { date: localDay, status: 'scheduled' },
    ]);
    // A session may have synchronized ahead of its occurrence lifecycle update.
    expect(derive([scheduled()], end + 60_000, [execution()]).dayStatuses).toEqual([
      { date: localDay, status: 'scheduled' },
    ]);
  });

  it('uses the original booked day for a late-completed linked session', () => {
    const startedNextDay = execution({
      status: 'completed', startedAt: '2026-10-21T04:00:00.000Z',
    });
    expect(derive([scheduled()], end + 60_000, [startedNextDay]).dayStatuses).toEqual([
      { date: localDay, status: 'completed' },
    ]);
    expect(derive([scheduled({ status: 'completed', workoutSessionId: 'session-1' })], end + 60_000)
      .dayStatuses).toEqual([{ date: localDay, status: 'completed' }]);
  });

  it('excludes cancelled, removed and personal events, but preserves previously published draft edits', () => {
    expect(derive([
      scheduled({ id: 'cancelled', cancelledAt: '2026-10-20T17:00:00.000Z' }),
      scheduled({ id: 'old-cancel', status: 'cancelled' }),
      scheduled({ id: 'inactive', inactive: true }),
      scheduled({ id: 'personal', entryKind: 'personal_event' }),
    ], end + 1).dayStatuses).toEqual([]);

    expect(derive([], end + 1, [], [draft()]).dayStatuses).toEqual([
      { date: localDay, status: 'missed' },
    ]);
    expect(derive([], end + 1, [], [draft({ previouslyPublished: false })]).dayStatuses).toEqual([]);
  });

  it('uses missed > scheduled > completed precedence for multiple workouts on a date', () => {
    const rows = [
      scheduled({ id: 'missed' }),
      scheduled({ id: 'upcoming', startsAtUtc: '2026-10-20T22:00:00.000Z' }),
      scheduled({ id: 'completed', status: 'completed' }),
    ];
    expect(derive(rows, end + 1).dayStatuses).toEqual([{ date: localDay, status: 'missed' }]);
    expect(derive(rows.slice(1), end + 1).dayStatuses).toEqual([{ date: localDay, status: 'scheduled' }]);
    expect(derive(rows.slice(2), end + 1).dayStatuses).toEqual([{ date: localDay, status: 'completed' }]);
    expect(derive(rows.slice(1), end + 1).nextChangeAt).toBe(at('2026-10-20T23:00:00.000Z'));
  });

  it('includes completed standalone sessions by actual start date, without duplicating linked sessions', () => {
    const standalone = execution({
      id: 'adhoc', occurrenceId: undefined,
      startedAt: '2026-10-22T09:00:00.000Z', status: 'completed',
    });
    const result = derive([scheduled()], end + 1, [execution({ status: 'completed' }), standalone]);
    expect(result.dayStatuses).toEqual([
      { date: localDay, status: 'completed' },
      { date: calendarDate(new Date(standalone.startedAt)), status: 'completed' },
    ]);
  });

  it('filters by the selected athletes and ignores unrelated or mismatched execution links', () => {
    expect(derive([scheduled()], end + 1, [], [], []).dayStatuses).toEqual([]);
    expect(derive([scheduled()], end + 1, [], [], ['tg:303']).dayStatuses).toEqual([]);
    expect(derive([scheduled()], end + 1, [execution({ realmId: 'foreign' })])
      .dayStatuses).toEqual([{ date: localDay, status: 'missed' }]);
    expect(derive([scheduled({ athleteUserId: 'tg:303' })], end + 1, [], [],
      ['tg:202', 'tg:303']).dayStatuses).toEqual([{ date: localDay, status: 'missed' }]);
  });

  it('uses local calendar dates, including UTC instants near midnight', () => {
    const timestamp = '2026-10-20T23:45:00.000Z';
    expect(derive([scheduled({ startsAtUtc: timestamp })], at(timestamp) - 1)
      .dayStatuses[0].date).toBe(calendarDate(new Date(timestamp)));
  });
});
