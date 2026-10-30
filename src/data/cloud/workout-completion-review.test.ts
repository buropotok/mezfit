import { describe, expect, it } from 'vitest';
import { completedWorkoutOverlaps } from './workout-completion-review';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
const actual = { occurrenceId: 'source', athleteUserId: 'tg:202', coachUserId: 'tg:101',
  format: 'coached' as const, startedAt: '2026-10-30T10:00:00.000Z', completedAt: '2026-10-30T12:00:00.000Z' };
const row: CloudWorkoutOccurrenceRow = { id: 'overlap', realmId: 'pair', owner: 'pair',
  athleteUserId: 'tg:303', coachUserId: 'tg:101', clientUserId: 'tg:303', format: 'coached',
  startsAtUtc: '2026-10-30T11:30:00.000Z', durationMinutes: 60, publicationStatus: 'published',
  status: 'scheduled', workoutSessionId: null, plan: { name: 'План', comment: null, exercises: [] } };
describe('completion overlap projection', () => {
  it('uses the entire actual interval across days, with half-open boundaries', () => {
    expect(completedWorkoutOverlaps(actual, [row])).toEqual([row]);
    expect(completedWorkoutOverlaps(actual, [
      { ...row, startsAtUtc: '2026-10-30T12:00:00.000Z' },
      { ...row, startsAtUtc: '2026-10-30T09:00:00.000Z' },
    ])).toEqual([]);
    expect(completedWorkoutOverlaps({ ...actual, startedAt: '2026-10-29T23:30:00.000Z' },
      [{ ...row, startsAtUtc: '2026-10-30T00:00:00.000Z' }])).toHaveLength(1);
  });
  it.each([
    { id: 'source' }, { cancelledAt: actual.startedAt }, { inactive: true }, { publicationStatus: 'draft' },
    { status: 'in_progress', workoutSessionId: 'execution' }, { status: 'completed', workoutSessionId: 'execution' },
    { entryKind: 'personal_event' }, { format: 'independent' },
  ] as const)('excludes non-actionable and unrelated entries: %j', changes => {
    expect(completedWorkoutOverlaps(actual, [{ ...row, ...changes }])).toEqual([]);
  });
  it('includes independent workouts of the same athlete, without occupying a different Coach', () => {
    expect(completedWorkoutOverlaps(actual, [{ ...row, format: 'independent', athleteUserId: actual.athleteUserId }])).toHaveLength(1);
    expect(completedWorkoutOverlaps({ ...actual, format: 'independent' }, [row])).toEqual([]);
  });
  it('never invents an interval for an active, zero-duration or invalid session', () => {
    for (const completedAt of [null, actual.startedAt, 'invalid'])
      expect(completedWorkoutOverlaps({ ...actual, completedAt }, [row])).toEqual([]);
  });
});
