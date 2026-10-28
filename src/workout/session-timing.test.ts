import { expect, it } from 'vitest';
import { sessionTiming } from './session-timing';

it('keeps the actual start and grows an active interval instead of using a planned duration', () => {
  const session = { startedAt: '2026-10-28T10:05:00.000Z', completedAt: null };
  expect(sessionTiming(session, Date.parse('2026-10-28T10:20:00.000Z'))).toEqual({
    startsAtUtc: session.startedAt, endsAtUtc: '2026-10-28T10:20:00.000Z', durationMinutes: 15,
  });
});
it('freezes completion even when the calendar is opened much later', () => {
  expect(sessionTiming({ startedAt: '2026-10-28T23:50:00.000Z', completedAt: '2026-10-29T00:20:00.000Z' },
    Date.parse('2026-11-01T15:00:00.000Z')).durationMinutes).toBe(30);
});
it('uses minimum geometry for a just-started session without inventing a future actual end', () => {
  const start = '2026-10-28T10:05:00.000Z';
  expect(sessionTiming({ startedAt: start, completedAt: null }, Date.parse(start) - 1000)).toEqual({
    startsAtUtc: start, endsAtUtc: start, durationMinutes: 1,
  });
});
