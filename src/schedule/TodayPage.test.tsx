// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getScheduleOccurrences, type ScheduleOccurrence } from '../api';
import { TodayPage } from './TodayPage';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, getScheduleOccurrences: vi.fn() };
});

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    DaySchedule: ({
      date,
      eventsByDate,
      onDateChange,
    }: {
      date: string;
      eventsByDate: Record<string, Array<{ id: string }>>;
      onDateChange: (date: string) => void;
    }) => (
      <div data-testid="day-schedule" data-date={date} data-event-count={eventsByDate[date]?.length ?? 0}>
        <button type="button" onClick={() => onDateChange('2026-12-20')}>Jump date</button>
      </div>
    ),
    DayScheduleEventCard: () => null,
    Avatar: () => null,
  };
});

const getScheduleMock = vi.mocked(getScheduleOccurrences);

function localDateNow(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function occurrence(date: string): ScheduleOccurrence {
  return {
    id: 11,
    calendarDate: date,
    dateKey: Number(date.replaceAll('-', '')),
    startMinute: 600,
    durationMinutes: 60,
    status: 'scheduled',
    program: { id: 1, name: 'Программа' },
    phase: { id: 2, name: 'Фаза' },
    day: { id: 3, name: 'День A', position: 0 },
    coach: { id: 7, firstName: 'Тренер', lastName: null, username: null, photoUrl: null },
    client: { id: 8, firstName: 'Клиент', lastName: null, username: null, photoUrl: null },
    sessionId: null,
  };
}

beforeEach(() => {
  getScheduleMock.mockReset();
});

afterEach(cleanup);

describe('TodayPage schedule loading', () => {
  it('loads Today first, renders it, then warms a +/-31 day cache without blocking the first result', async () => {
    const today = localDateNow();
    let resolveToday: (value: { occurrences: ScheduleOccurrence[] }) => void = () => undefined;
    const todayRequest = new Promise<{ occurrences: ScheduleOccurrence[] }>((resolve) => {
      resolveToday = resolve;
    });
    getScheduleMock
      .mockReturnValueOnce(todayRequest)
      .mockResolvedValueOnce({ occurrences: [occurrence(today)] });
    const onNavigationContextChange = vi.fn();

    render(
      <TodayPage
        initData="telegram-init"
        role="coach"
        onNavigationContextChange={onNavigationContextChange}
      />,
    );

    await waitFor(() => expect(getScheduleMock).toHaveBeenCalledTimes(1));
    expect(getScheduleMock).toHaveBeenNthCalledWith(
      1,
      'telegram-init',
      'coach',
      today,
      today,
      expect.anything(),
    );

    await act(async () => resolveToday({ occurrences: [occurrence(today)] }));

    await waitFor(() => {
      expect(screen.getByTestId('day-schedule').getAttribute('data-event-count')).toBe('1');
      expect(getScheduleMock).toHaveBeenCalledTimes(2);
    });
    expect(getScheduleMock).toHaveBeenNthCalledWith(
      2,
      'telegram-init',
      'coach',
      addDays(today, -31),
      addDays(today, 31),
      expect.anything(),
    );

    expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({
      level: 1,
      contentMode: 'viewport',
      calendar: expect.objectContaining({ value: today }),
    }));
  });

  it('loads another +/-31 day window only when navigation leaves the warmed cache', async () => {
    const today = localDateNow();
    getScheduleMock.mockResolvedValue({ occurrences: [] });

    render(
      <TodayPage
        initData="telegram-init"
        role="client"
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(getScheduleMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Jump date' }));

    await waitFor(() => expect(getScheduleMock).toHaveBeenCalledTimes(3));
    expect(getScheduleMock).toHaveBeenNthCalledWith(
      3,
      'telegram-init',
      'client',
      addDays('2026-12-20', -31),
      addDays('2026-12-20', 31),
      expect.anything(),
    );

    expect(getScheduleMock).toHaveBeenNthCalledWith(
      2,
      'telegram-init',
      'client',
      addDays(today, -31),
      addDays(today, 31),
      expect.anything(),
    );
  });
});
