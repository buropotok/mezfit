import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleScheduleRoute } from './schedule-api';
import {
  cancelOccurrence,
  createScheduleOccurrence,
  listScheduleOccurrences,
  rescheduleOccurrence,
} from './schedule';

vi.mock('./schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./schedule')>();
  return {
    ...actual,
    cancelOccurrence: vi.fn(),
    createScheduleOccurrence: vi.fn(),
    listScheduleOccurrences: vi.fn(),
    rescheduleOccurrence: vi.fn(),
  };
});

const listMock = vi.mocked(listScheduleOccurrences);
const createMock = vi.mocked(createScheduleOccurrence);
const rescheduleMock = vi.mocked(rescheduleOccurrence);
const cancelMock = vi.mocked(cancelOccurrence);
const db = {} as D1Database;

const occurrence = {
  id: 11,
  calendarDate: '2026-10-05',
  dateKey: 20261005,
  startMinute: 600,
  durationMinutes: 60,
  status: 'scheduled' as const,
  createdByUserId: 7,
  program: { id: 1, name: 'Программа' },
  phase: { id: 2, name: 'Фаза' },
  day: { id: 3, name: 'День A', position: 0 },
  coach: { id: 7, firstName: 'Coach', lastName: null, username: null, photoUrl: null },
  client: { id: 8, firstName: 'Client', lastName: null, username: null, photoUrl: null },
  sessionId: null,
};

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  rescheduleMock.mockReset();
  cancelMock.mockReset();
});

describe('schedule API', () => {
  it('loads an indexed coach date range only for a user with the coach role', async () => {
    listMock.mockResolvedValue([occurrence]);
    const request = new Request('https://mezfit.test/api/schedule?role=coach&from=2026-10-05&to=2026-10-05');

    const response = await handleScheduleRoute(request, db, 7, ['coach']);

    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(db, 7, 'coach', 20261005, 20261005);
    await expect(response.json()).resolves.toEqual({ occurrences: [occurrence] });
  });

  it('rejects a schedule role the authenticated user does not own', async () => {
    const request = new Request('https://mezfit.test/api/schedule?role=coach&from=2026-10-05&to=2026-10-05');

    const response = await handleScheduleRoute(request, db, 8, ['client']);

    expect(response.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('creates a coach-owned occurrence with validated local calendar timing', async () => {
    createMock.mockResolvedValue({ kind: 'ok', occurrence });
    const request = new Request('https://mezfit.test/api/schedule/occurrences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientUserId: 8,
        programDayId: 3,
        date: '2026-10-05',
        startMinute: 600,
        durationMinutes: 60,
      }),
    });

    const response = await handleScheduleRoute(request, db, 7, ['coach']);

    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(db, 7, {
      clientUserId: 8,
      programDayId: 3,
      day: expect.objectContaining({ dateKey: 20261005, localDate: '2026-10-05' }),
      startMinute: 600,
      durationMinutes: 60,
    });
  });

  it('prevents rescheduling an occurrence after execution has locked it', async () => {
    rescheduleMock.mockResolvedValue({ kind: 'locked' });
    const request = new Request('https://mezfit.test/api/schedule/occurrences/11', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-10-06', startMinute: 660, durationMinutes: 60 }),
    });

    const response = await handleScheduleRoute(request, db, 7, ['coach']);

    expect(response.status).toBe(409);
  });

  it('cancels a scheduled occurrence instead of physically deleting history', async () => {
    cancelMock.mockResolvedValue('ok');
    const request = new Request('https://mezfit.test/api/schedule/occurrences/11', { method: 'DELETE' });

    const response = await handleScheduleRoute(request, db, 7, ['coach']);

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith(db, 7, 11);
  });
});
