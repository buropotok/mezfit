import { describe, expect, it } from 'vitest';
import { bookingsOverlap } from './workout-slot-validation';

const coached = { athleteUserId: 'tg:202', coachUserId: 'tg:101', format: 'coached' as const,
  startsAtUtc: '2026-10-19T09:30:00.000Z', durationMinutes: 60 };
describe('local athlete and coach occupancy', () => {
  it('rejects an athlete independent workout overlapping their coached workout', () => {
    expect(bookingsOverlap(coached, { ...coached, format: 'independent' })).toBe(true);
    expect(bookingsOverlap(coached, { ...coached, athleteUserId: 'tg:101', coachUserId: null, format: 'independent' })).toBe(true);
  });
  it('does not reserve a coach for another client independent workout', () => {
    expect(bookingsOverlap(coached, { ...coached, athleteUserId: 'tg:303', format: 'independent' })).toBe(false);
  });
  it('allows adjacent intervals and separate workouts on the same day', () => {
    expect(bookingsOverlap(coached, { ...coached, startsAtUtc: '2026-10-19T10:30:00.000Z' })).toBe(false);
    expect(bookingsOverlap(coached, { ...coached, startsAtUtc: '2026-10-19T12:00:00.000Z' })).toBe(false);
  });
});
