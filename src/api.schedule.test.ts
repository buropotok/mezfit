import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getScheduleOccurrences, initializeWorkoutSession } from './api';

const fetchMock = vi.fn();

const validOccurrence = {
  id: 11,
  calendarDate: '2026-10-05',
  dateKey: 20261005,
  startMinute: 600,
  durationMinutes: 60,
  status: 'scheduled',
  createdByUserId: 7,
  program: { id: 1, name: 'Программа' },
  phase: { id: 2, name: 'Фаза' },
  day: { id: 3, name: 'День A', position: 0 },
  coach: { id: 7, firstName: 'Тренер', lastName: null, username: null, photoUrl: null },
  client: { id: 8, firstName: 'Клиент', lastName: null, username: null, photoUrl: null },
  sessionId: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('schedule API runtime contract', () => {
  it('accepts a valid schedule projection', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ occurrences: [validOccurrence] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getScheduleOccurrences(
      'telegram-init',
      'coach',
      '2026-10-05',
      '2026-10-05',
    )).resolves.toEqual({ occurrences: [validOccurrence] });
  });

  it('rejects a schedule row without a valid creator id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      occurrences: [{ ...validOccurrence, createdByUserId: null }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getScheduleOccurrences(
      'telegram-init',
      'client',
      '2026-10-05',
      '2026-10-05',
    )).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });

  it('rejects malformed schedule rows instead of trusting the TypeScript shape', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      occurrences: [{ ...validOccurrence, startMinute: '10:00' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getScheduleOccurrences(
      'telegram-init',
      'coach',
      '2026-10-05',
      '2026-10-05',
    )).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });

  it('rejects scheduled_today workout metadata without a persisted occurrence id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      session: {
        sessionId: 501,
        status: 'draft',
        program: { id: 1, name: 'Программа' },
        phase: { id: 2, name: 'Фаза' },
        suggestedDay: {
          id: 3,
          name: 'День A',
          position: 0,
          completed: false,
          resolution: 'scheduled_today',
          occurrenceId: null,
        },
        availableDays: [],
      },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(initializeWorkoutSession(
      'telegram-init',
      1,
      '2026-10-05',
    )).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });

  it('rejects a date key that does not match the returned local date', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      occurrences: [{ ...validOccurrence, dateKey: 20261006 }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getScheduleOccurrences(
      'telegram-init',
      'client',
      '2026-10-05',
      '2026-10-05',
    )).rejects.toBeInstanceOf(ApiError);
  });
});
