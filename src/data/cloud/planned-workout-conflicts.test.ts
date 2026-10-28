import { describe, expect, it } from 'vitest';
import { currentStartConflicts } from './planned-workout-conflicts';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

const row = (id: string, athlete: string, changes: Partial<CloudWorkoutOccurrenceRow> = {}): CloudWorkoutOccurrenceRow => ({
  id, owner: 'pair', realmId: 'pair', coachUserId: 'tg:1', clientUserId: athlete, athleteUserId: athlete,
  format: 'coached', startsAtUtc: '2026-10-28T10:00:00.000Z', durationMinutes: 60,
  plan: { name: 'Тренировка', comment: null, exercises: [] }, status: 'scheduled', workoutSessionId: null, ...changes,
});
const selected = row('selected', 'tg:2');

describe('conflict at actual planned-workout Start', () => {
  it('finds another athlete occupying the same coach at the actual start, regardless of selected planned date', () => {
    const other = row('other', 'tg:3');
    expect(currentStartConflicts({ ...selected, startsAtUtc: '2026-10-29T10:00:00.000Z' },
      [selected, other], '2026-10-28T10:05:00.000Z')).toEqual([other]);
  });
  it('does not cancel the same athlete on another day or the selected occurrence itself', () => {
    expect(currentStartConflicts(selected, [selected, row('other-day', 'tg:2')],
      '2026-10-28T10:05:00.000Z')).toEqual([]);
  });
  it('does not reserve a future interval from an estimated session length; end is exclusive', () => {
    expect(currentStartConflicts(selected, [row('next', 'tg:3', { startsAtUtc: '2026-10-28T11:00:00.000Z' }),
      row('ended', 'tg:4', { startsAtUtc: '2026-10-28T09:00:00.000Z' })],
      '2026-10-28T10:00:00.000Z')).toEqual([]);
  });
  it.each([
    { cancelledAt: '2026-10-28T09:00:00.000Z' }, { status: 'cancelled' as const },
    { status: 'in_progress' as const, workoutSessionId: 'session' },
    { entryKind: 'personal_event' as const }, { format: 'independent' as const }, { coachUserId: 'tg:9' },
  ])('ignores a booking that does not require this cancellation flow: %j', changes => {
    expect(currentStartConflicts(selected, [row('other', 'tg:3', changes)], '2026-10-28T10:05:00.000Z')).toEqual([]);
  });
});
