import { describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrence, dayDistance, listScheduleOccurrences, parseCalendarDay, rescheduleOccurrence } from './schedule';

describe('schedule calendar dates', () => {
  it('derives a sortable YYYYMMDD key and ISO week metadata', () => {
    expect(parseCalendarDay('2026-10-05')).toEqual({
      dateKey: 20261005,
      localDate: '2026-10-05',
      year: 2026,
      month: 10,
      day: 5,
      isoWeekYear: 2026,
      isoWeek: 41,
      weekday: 1,
    });
  });

  it('keeps ISO week year separate from calendar year at year boundaries', () => {
    expect(parseCalendarDay('2027-01-01')).toMatchObject({
      dateKey: 20270101,
      year: 2027,
      isoWeekYear: 2026,
      isoWeek: 53,
      weekday: 5,
    });
  });

  it('rejects impossible dates and computes range distance without local timezone conversion', () => {
    expect(parseCalendarDay('2026-02-29')).toBeNull();
    const from = parseCalendarDay('2026-09-05');
    const to = parseCalendarDay('2026-11-05');
    if (!from || !to) throw new Error('Expected valid dates');
    expect(dayDistance(from, to)).toBe(61);
  });
});


describe('schedule occurrence read model', () => {
  it('projects the occurrence creator for frontend editability decisions', async () => {
    let selectedSql = '';
    const row = {
      id: 11,
      calendar_date: '2026-10-05',
      calendar_date_key: 20261005,
      start_minute: 600,
      duration_minutes: 60,
      status: 'scheduled' as const,
      created_by_user_id: 8,
      program_id: 1,
      program_name: 'Программа',
      phase_id: 2,
      phase_name: 'Фаза',
      day_id: 3,
      day_name: 'День A',
      day_position: 0,
      coach_id: 7,
      coach_first_name: 'Coach',
      coach_last_name: null,
      coach_username: null,
      coach_photo_url: null,
      client_id: 8,
      client_first_name: 'Client',
      client_last_name: null,
      client_username: null,
      client_photo_url: null,
      session_id: null,
    };
    const prepare = vi.fn((sql: string) => {
      selectedSql = sql;
      return {
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [row] }),
        }),
      };
    });
    const db = { prepare } as unknown as D1Database;

    await expect(listScheduleOccurrences(db, 8, 'client', 20261005, 20261005)).resolves.toEqual([
      expect.objectContaining({ id: 11, createdByUserId: 8 }),
    ]);
    expect(selectedSql).toContain('occurrence.created_by_user_id');
  });
});

describe('calendar reference writes', () => {
  it('uses the persisted calendar_day key when creating an occurrence', async () => {
    const targetFirst = vi.fn().mockResolvedValue({ id: 3 });
    const calendarFirst = vi.fn().mockResolvedValue({ date_key: 20261005 });
    const insertFirst = vi.fn().mockResolvedValue({ id: 11 });
    const occurrenceFirst = vi.fn().mockResolvedValue({
      id: 11,
      calendar_date: '2026-10-05',
      calendar_date_key: 20261005,
      start_minute: 600,
      duration_minutes: 60,
      status: 'scheduled',
      created_by_user_id: 7,
      program_id: 1,
      program_name: 'Программа',
      phase_id: 2,
      phase_name: 'Фаза',
      day_id: 3,
      day_name: 'День A',
      day_position: 0,
      coach_id: 7,
      coach_first_name: 'Coach',
      coach_last_name: null,
      coach_username: 'coach',
      coach_photo_url: null,
      client_id: 8,
      client_first_name: 'Client',
      client_last_name: null,
      client_username: 'client',
      client_photo_url: null,
      session_id: null,
    });
    const insertBind = vi.fn().mockReturnValue({ first: insertFirst });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('SELECT program_day.id')) {
        return { bind: vi.fn().mockReturnValue({ first: targetFirst }) };
      }
      if (sql.includes('SELECT date_key') && sql.includes('FROM calendar_day')) {
        return { bind: vi.fn().mockReturnValue({ first: calendarFirst }) };
      }
      if (sql.includes('INSERT INTO workout_occurrence')) {
        return { bind: insertBind };
      }
      if (sql.includes('FROM workout_occurrence occurrence')) {
        return { bind: vi.fn().mockReturnValue({ first: occurrenceFirst }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const db = { prepare } as unknown as D1Database;
    const parsed = parseCalendarDay('2026-10-05');
    if (!parsed) throw new Error('Expected valid date');
    const day = { ...parsed, dateKey: 19990101 };

    await expect(createScheduleOccurrence(db, 7, {
      clientUserId: 8,
      programDayId: 3,
      day,
      startMinute: 600,
      durationMinutes: 60,
    })).resolves.toMatchObject({
      kind: 'ok',
      occurrence: { id: 11, dateKey: 20261005 },
    });

    expect(insertBind).toHaveBeenCalledWith(7, 8, 3, 20261005, 600, 60, 7);
  });

  it('rejects occurrence creation when the requested date is absent from calendar_day', async () => {
    const targetFirst = vi.fn().mockResolvedValue({ id: 3 });
    const calendarFirst = vi.fn().mockResolvedValue(null);
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('SELECT program_day.id')) {
        return { bind: vi.fn().mockReturnValue({ first: targetFirst }) };
      }
      if (sql.includes('SELECT date_key') && sql.includes('FROM calendar_day')) {
        return { bind: vi.fn().mockReturnValue({ first: calendarFirst }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const db = { prepare } as unknown as D1Database;
    const day = parseCalendarDay('2200-01-01');
    if (!day) throw new Error('Expected syntactically valid date');

    await expect(createScheduleOccurrence(db, 7, {
      clientUserId: 8,
      programDayId: 3,
      day,
      startMinute: 600,
      durationMinutes: 60,
    })).resolves.toEqual({ kind: 'calendar_day_not_found' });

    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO calendar_day'));
  });
});

describe('schedule occurrence races', () => {
  it('reports a locked reschedule when the guarded update loses a Start race', async () => {
    const existingFirst = vi.fn().mockResolvedValue({
      id: 11,
      coach_user_id: 7,
      client_user_id: 8,
      program_day_id: 3,
      status: 'scheduled',
    });
    const calendarFirst = vi.fn().mockResolvedValue({ date_key: 20261006 });
    const updateRun = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM workout_occurrence occurrence')) {
        return { bind: vi.fn().mockReturnValue({ first: existingFirst }) };
      }
      if (sql.includes('SELECT date_key') && sql.includes('FROM calendar_day')) {
        return { bind: vi.fn().mockReturnValue({ first: calendarFirst }) };
      }
      if (sql.includes('UPDATE workout_occurrence')) {
        return { bind: vi.fn().mockReturnValue({ run: updateRun }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const db = { prepare } as unknown as D1Database;
    const day = parseCalendarDay('2026-10-06');
    if (!day) throw new Error('Expected valid date');

    await expect(rescheduleOccurrence(db, 7, 11, day, 660, 60)).resolves.toEqual({ kind: 'locked' });
  });
});
