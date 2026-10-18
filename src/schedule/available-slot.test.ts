import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextAvailableSlot } from './available-slot';

afterEach(() => vi.unstubAllEnvs());
describe('local free-slot suggestion', () => {
  it('returns no suggestion when the search is exhausted', () => {
    vi.stubEnv('TZ', 'UTC');
    const from = new Date('2026-10-19T08:00:00.000Z');
    expect(nextAvailableSlot([{ startsAtUtc: from.toISOString(), durationMinutes: 60 * 24 * 60 }], from, 60))
      .toBeNull();
    expect(from.toISOString()).toBe('2026-10-19T08:00:00.000Z');
  });

  it('skips occupied intervals and allows an exact adjacent boundary', () => {
    vi.stubEnv('TZ', 'UTC');
    const result = nextAvailableSlot([
      { startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 90 },
    ], new Date('2026-10-19T08:01:00.000Z'), 60);
    expect(result?.toISOString()).toBe('2026-10-19T09:30:00.000Z');
  });
});
