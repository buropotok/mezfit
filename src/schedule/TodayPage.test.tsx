// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelScheduleOccurrence, getScheduleOccurrences, rescheduleScheduleOccurrence, type ScheduleOccurrence } from '../api';
import { NavigationShell, type NavigationContext } from '../NavigationShell';
import { getUiIconAsset } from '../ui/icons/registry';
import { TodayPage } from './TodayPage';

vi.mock('../client/ClientCoachSelectorModal', () => ({
  ClientCoachSelectorModal: () => null,
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    getScheduleOccurrences: vi.fn(),
    rescheduleScheduleOccurrence: vi.fn(),
    cancelScheduleOccurrence: vi.fn(),
  };
});

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    DaySchedule: ({
      date,
      eventsByDate,
      onDateChange,
      isEventEditable,
      onEventMove,
      onEventResize,
      onEventDelete,
      renderEvent,
    }: {
      date: string;
      eventsByDate: Record<string, Array<{
        id: string;
        startMinutes: number;
        durationMinutes: number;
        occurrence: ScheduleOccurrence;
      }>>;
      onDateChange: (date: string) => void;
      isEventEditable?: (event: {
        id: string;
        startMinutes: number;
        durationMinutes: number;
        occurrence: ScheduleOccurrence;
      }) => boolean;
      onEventMove?: (move: {
        eventId: string;
        date: string;
        targetDate: string;
        previousStartMinutes: number;
        startMinutes: number;
      }) => void;
      onEventResize?: (resize: {
        eventId: string;
        date: string;
        previousStartMinutes: number;
        previousDurationMinutes: number;
        startMinutes: number;
        durationMinutes: number;
      }) => void;
      onEventDelete?: (deletion: { eventId: string; date: string }) => void;
      renderEvent?: (event: {
        id: string;
        startMinutes: number;
        durationMinutes: number;
        occurrence: ScheduleOccurrence;
      }, state: {
        compact: boolean;
        lifted: boolean;
        editing: boolean;
        height: number;
        startMinutes: number;
        durationMinutes: number;
      }) => ReactNode;
    }) => {
      const events = eventsByDate[date] ?? [];
      const first = events[0];
      const firstEditable = first ? (isEventEditable?.(first) ?? true) : false;
      return (
        <div
          data-testid="day-schedule"
          data-date={date}
          data-event-count={events.length}
          data-editable-count={events.filter(event => isEventEditable?.(event) ?? true).length}
          data-first-start={first?.startMinutes ?? ''}
          data-first-duration={first?.durationMinutes ?? ''}
        >
          {first && renderEvent ? renderEvent(first, {
            compact: false,
            lifted: false,
            editing: false,
            height: 62,
            startMinutes: first.startMinutes,
            durationMinutes: first.durationMinutes,
          }) : null}
          <button type="button" onClick={() => onDateChange('2026-12-20')}>Jump date</button>
          <button
            type="button"
            disabled={!firstEditable}
            onClick={() => first && onEventMove?.({
              eventId: first.id,
              date,
              targetDate: date,
              previousStartMinutes: first.startMinutes,
              startMinutes: first.startMinutes + 30,
            })}
          >
            Move first
          </button>
          <button
            type="button"
            disabled={!firstEditable}
            onClick={() => first && onEventResize?.({
              eventId: first.id,
              date,
              previousStartMinutes: first.startMinutes,
              previousDurationMinutes: first.durationMinutes,
              startMinutes: first.startMinutes,
              durationMinutes: first.durationMinutes + 15,
            })}
          >
            Resize first
          </button>
          <button
            type="button"
            disabled={!firstEditable}
            onClick={() => first && onEventDelete?.({ eventId: first.id, date })}
          >
            Delete first
          </button>
        </div>
      );
    },
    DayScheduleEventCard: ({
      title,
      detail,
      media,
    }: {
      title: ReactNode;
      detail?: ReactNode;
      media?: ReactNode;
    }) => (
      <div data-testid="event-card">
        <span data-testid="event-title">{title}</span>
        <span data-testid="event-detail">{detail}</span>
        {media}
      </div>
    ),
    Avatar: ({ name, src }: { name: string; src?: string }) => (
      <span data-testid="event-avatar" data-name={name} data-src={src ?? ''} />
    ),
  };
});

const getScheduleMock = vi.mocked(getScheduleOccurrences);
const rescheduleMock = vi.mocked(rescheduleScheduleOccurrence);
const cancelMock = vi.mocked(cancelScheduleOccurrence);

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
    createdByUserId: 7,
    program: { id: 1, name: 'Программа' },
    phase: { id: 2, name: 'Фаза' },
    day: { id: 3, name: 'День A', position: 0 },
    coach: { id: 7, firstName: 'Тренер', lastName: null, username: null, photoUrl: null },
    client: { id: 8, firstName: 'Клиент', lastName: null, username: null, photoUrl: null },
    sessionId: null,
  };
}

const coachMe = {
  user: {
    id: 7,
    telegramUserId: '7',
    username: null,
    firstName: 'Тренер',
    lastName: null,
    languageCode: 'ru',
    photoUrl: null,
    isPremium: false,
  },
  roles: ['coach' as const],
};

function CoachTodayNavigationHarness() {
  const [context, setContext] = useState<NavigationContext | null>(null);
  return (
    <NavigationShell
      me={coachMe}
      activeRole="coach"
      destination="today"
      context={context}
      onDestinationChange={vi.fn()}
      onRoleSwitch={vi.fn()}
    >
      <TodayPage
        initData="telegram-init"
        role="coach"
        currentUserId={7}
        onNavigationContextChange={setContext}
      />
    </NavigationShell>
  );
}

beforeEach(() => {
  getScheduleMock.mockReset();
  rescheduleMock.mockReset();
  cancelMock.mockReset();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.history.replaceState({}, '');
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TodayPage schedule loading', () => {
  it('opens coach schedule creation sheets from the FAB liquid popover', async () => {
    getScheduleMock.mockResolvedValue({ occurrences: [] });
    const view = render(<CoachTodayNavigationHarness />);

    const fab = await screen.findByRole('button', { name: 'Добавить' });
    const icon = fab.querySelector<HTMLElement>('.ui-icon');
    expect(icon?.style.maskImage).toContain(getUiIconAsset('plus', 'outline'));

    fireEvent.click(fab);
    const addMenu = screen.getByRole('menu', { name: 'Добавить' });
    expect(addMenu.querySelectorAll('.ui-menu-item__leading .ui-icon')).toHaveLength(2);
    expect(screen.getByRole('menuitem', { name: 'Тренировка' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Событие' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Событие' }));

    expect(await screen.findByRole('dialog', { name: 'Событие' })).toBeTruthy();
    await waitFor(() => {
      expect(view.container.querySelector('.ui-mezfit-navbar__identity')?.textContent).toContain('Событие');
    });
    const eventNavbarIcon = view.container.querySelector<HTMLElement>('.ui-mezfit-navbar__identity .ui-icon');
    expect(eventNavbarIcon?.style.maskImage).toContain(getUiIconAsset('plus', 'outline'));
    expect(screen.getByRole('button', { name: 'Назад' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Событие' })).toBeNull();
    expect(screen.queryByText('Экран создания события будет реализован отдельной задачей.')).toBeNull();
    expect(view.container.querySelector('.navigation-primary-tabs > div')?.hasAttribute('hidden')).toBe(true);

    expect(document.querySelector('.ui-mezfit-bottom-sheet__backdrop')).toBeNull();
    await waitFor(() => {
      expect(window.history.state?.__mezfitNavigationToken).toBeTruthy();
    });
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(historyBack).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    const restoredFab = await screen.findByRole('button', { name: 'Добавить' });
    fireEvent.click(restoredFab);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Тренировка' }));

    expect(await screen.findByRole('dialog', { name: 'Тренировка' })).toBeTruthy();
    await waitFor(() => {
      expect(view.container.querySelector('.ui-mezfit-navbar__identity')?.textContent).toContain('Тренировка');
    });
    const workoutNavbarIcon = view.container.querySelector<HTMLElement>('.ui-mezfit-navbar__identity .ui-icon');
    expect(workoutNavbarIcon?.style.maskImage).toContain(getUiIconAsset('plus', 'outline'));
  });

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
        currentUserId={7}
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

  it('uses the client avatar for a self-created workout in client mode', async () => {
    const today = localDateNow();
    const selfWorkout: ScheduleOccurrence = {
      ...occurrence(today),
      createdByUserId: 8,
      coach: {
        ...occurrence(today).coach,
        firstName: 'Тренер',
        photoUrl: 'https://example.test/coach.jpg',
      },
      client: {
        ...occurrence(today).client,
        firstName: 'Клиент',
        photoUrl: 'https://example.test/client.jpg',
      },
    };
    getScheduleMock.mockResolvedValue({ occurrences: [selfWorkout] });

    render(
      <TodayPage
        initData="telegram-init"
        role="client"
        currentUserId={8}
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('event-avatar').getAttribute('data-name')).toBe('Клиент'));
    expect(screen.getByTestId('event-avatar').getAttribute('data-src')).toBe('https://example.test/client.jpg');
    expect(screen.getByTestId('event-detail').textContent).toContain('Клиент');
    expect(screen.getByTestId('event-detail').textContent).not.toContain('Тренер');
  });

  it('marks only scheduled coach events editable', async () => {
    const today = localDateNow();
    getScheduleMock.mockResolvedValue({
      occurrences: [
        occurrence(today),
        { ...occurrence(today), id: 12, status: 'in_progress', createdByUserId: 8 },
        { ...occurrence(today), id: 13, status: 'completed', createdByUserId: 7 },
      ],
    });

    render(
      <TodayPage
        initData="telegram-init"
        role="coach"
        currentUserId={7}
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('day-schedule').getAttribute('data-editable-count')).toBe('1'));
  });

  it('lets a client edit only scheduled occurrences they created', async () => {
    const today = localDateNow();
    getScheduleMock.mockResolvedValue({
      occurrences: [
        { ...occurrence(today), id: 11, createdByUserId: 8 },
        { ...occurrence(today), id: 12, createdByUserId: 7 },
        { ...occurrence(today), id: 13, status: 'in_progress', createdByUserId: 8 },
      ],
    });

    render(
      <TodayPage
        initData="telegram-init"
        role="client"
        currentUserId={8}
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('day-schedule').getAttribute('data-editable-count')).toBe('1'));
  });

  it('persists DnD moves and replaces the optimistic event with the backend occurrence', async () => {
    const today = localDateNow();
    const original = occurrence(today);
    const moved = { ...original, startMinute: 630 };
    getScheduleMock.mockResolvedValue({ occurrences: [original] });
    rescheduleMock.mockResolvedValue({ occurrence: moved });

    render(
      <TodayPage
        initData="telegram-init"
        role="coach"
        currentUserId={7}
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect((screen.getByRole('button', { name: 'Move first' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Move first' }));

    await waitFor(() => expect(rescheduleMock).toHaveBeenCalledWith('telegram-init', 11, {
      date: today,
      startMinute: 630,
      durationMinutes: 60,
    }));
    await waitFor(() => expect(screen.getByTestId('day-schedule').getAttribute('data-first-start')).toBe('630'));
  });

  it('persists resize for a client-created scheduled occurrence', async () => {
    const today = localDateNow();
    const original = { ...occurrence(today), createdByUserId: 8 };
    const resized = { ...original, durationMinutes: 75 };
    getScheduleMock.mockResolvedValue({ occurrences: [original] });
    rescheduleMock.mockResolvedValue({ occurrence: resized });

    render(
      <TodayPage
        initData="telegram-init"
        role="client"
        currentUserId={8}
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect((screen.getByRole('button', { name: 'Resize first' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Resize first' }));

    await waitFor(() => expect(rescheduleMock).toHaveBeenCalledWith('telegram-init', 11, {
      date: today,
      startMinute: 600,
      durationMinutes: 75,
    }));
    await waitFor(() => expect(screen.getByTestId('day-schedule').getAttribute('data-first-duration')).toBe('75'));
  });

  it('cancels and removes a client-created scheduled occurrence', async () => {
    const today = localDateNow();
    const original = { ...occurrence(today), createdByUserId: 8 };
    getScheduleMock.mockResolvedValue({ occurrences: [original] });
    cancelMock.mockResolvedValue({ ok: true });

    render(
      <TodayPage
        initData="telegram-init"
        role="client"
        currentUserId={8}
        onNavigationContextChange={vi.fn()}
      />,
    );

    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete first' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Delete first' }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('telegram-init', 11));
    await waitFor(() => expect(screen.getByTestId('day-schedule').getAttribute('data-event-count')).toBe('0'));
  });

  it('loads another +/-31 day window only when navigation leaves the warmed cache', async () => {
    const today = localDateNow();
    getScheduleMock.mockResolvedValue({ occurrences: [] });

    render(
      <TodayPage
        initData="telegram-init"
        role="client"
        currentUserId={8}
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
