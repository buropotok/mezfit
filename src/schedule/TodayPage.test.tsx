// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { confirmCloudWorkoutOccurrence, getScheduleOccurrences } from '../api';
import { TodayPage } from './TodayPage';

const state = vi.hoisted(() => ({
  cloudRows: [] as CloudWorkoutOccurrenceRow[],
  localRows: [] as LocalWorkoutOccurrenceDraft[],
  calendarChanged: null as null | ((rows: CloudWorkoutOccurrenceRow[]) => void),
  draftsChanged: null as null | ((rows: LocalWorkoutOccurrenceDraft[]) => void),
  requestedDraftId: null as string | null,
  actorUserId: 'tg:101',
  db: {},
  closed: 0,
}));

vi.mock('../api', async importOriginal => ({
  ...await importOriginal<typeof import('../api')>(),
  getScheduleOccurrences: vi.fn(),
  confirmCloudWorkoutOccurrence: vi.fn(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    actorUserId: state.actorUserId, db: state.db, clients: [], coaches: [],
    status: 'ready', error: '', syncStatus: 'synced',
  }),
}));
vi.mock('../data/cloud/workout-scheduling', () => ({
  WorkoutSchedulingRepository: class {
    observeCalendar(onChange: (rows: CloudWorkoutOccurrenceRow[]) => void) {
      state.calendarChanged = onChange;
      onChange(state.cloudRows);
      return { unsubscribe: vi.fn() };
    }
  },
}));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({
  WorkoutOccurrenceDraftRepository: class {
    observe(onChange: (rows: LocalWorkoutOccurrenceDraft[]) => void) {
      state.draftsChanged = onChange;
      onChange(state.localRows);
      return { unsubscribe: vi.fn() };
    }
    async get(id: string) { return state.localRows.find(row => row.id === id) ?? null; }
    async delete(id: string) {
      state.localRows = state.localRows.filter(row => row.id !== id);
      state.draftsChanged?.(state.localRows);
    }
  },
}));
vi.mock('./SchedulePlanningContext', () => ({
  useSchedulePlanning: () => ({
    requestedDraftId: state.requestedDraftId,
    clearDraft: () => { state.requestedDraftId = null; },
    openDraft: (id: string) => { state.requestedDraftId = id; },
  }),
}));
vi.mock('./OccurrenceDraftSheet', () => ({
  OccurrenceDraftSheet: ({ draft, onSave, onClose }: {
    draft: LocalWorkoutOccurrenceDraft | null;
    onSave: (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => Promise<void>;
    onClose: () => void;
  }) => draft ? <div role="dialog" aria-label="Запланировать тренировку">
    <span>Редактор: {draft.plan.name}</span>
    <button onClick={() => { void onSave(draft, false).catch(() => undefined); }}>Сохранить</button>
    <button onClick={onClose}>Закрыть</button>
  </div> : null,
}));
vi.mock('../ui', async importOriginal => ({
  ...await importOriginal<typeof import('../ui')>(),
  DaySchedule: ({ eventsByDate, renderEvent }: {
    eventsByDate: Record<string, Array<{ id: string; startMinutes: number; durationMinutes: number }>>;
    renderEvent: (item: { id: string; startMinutes: number; durationMinutes: number }, state: unknown) => ReactNode;
  }) => <div data-testid="calendar">
    {Object.values(eventsByDate).flat().map(item => (
      <div key={item.id}>{renderEvent(item, {
        startMinutes: item.startMinutes, durationMinutes: item.durationMinutes,
        compact: false, editing: false, lifted: false,
      })}</div>
    ))}
  </div>,
  DayScheduleEventCard: ({ title, detail, onClick }: {
    title: ReactNode; detail?: ReactNode; onClick?: () => void;
  }) => <button onClick={onClick}>{title} {detail}</button>,
}));

const prescription = { name: 'День 1', comment: null, exercises: [] };
const baseDraft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:abc12345', actorUserId: 'tg:101', realmId: 'tg:101',
  trainingPlanId: 'program-a', programDayId: 'day-a',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z',
  durationMinutes: 60, plan: prescription, originalPlan: prescription,
  createdAt: '2026-10-18T12:00:00.000Z', updatedAt: '2026-10-18T12:00:00.000Z',
};
const occurrence: CloudWorkoutOccurrenceRow = {
  id: 'occ-one', realmId: 'tg:101', owner: null, programDayId: 'day-a',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  workoutSessionId: null, format: 'independent',
  startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
  status: 'scheduled', plan: prescription,
};

beforeEach(() => {
  state.cloudRows = []; state.localRows = []; state.requestedDraftId = null;
  state.calendarChanged = null; state.draftsChanged = null;
  state.closed = 0; state.actorUserId = 'tg:101';
  vi.mocked(confirmCloudWorkoutOccurrence).mockReset();
  vi.mocked(getScheduleOccurrences).mockReset();
});
afterEach(cleanup);
const open = () => render(<TodayPage initData="telegram-session" role="coach" currentUserId={101}
  onNavigationContextChange={vi.fn()} />);

describe('Dexie-backed schedule', () => {
  it('renders confirmed occurrences without fetching obsolete D1 calendar rows', async () => {
    state.cloudRows = [occurrence];
    open();
    await waitFor(() => expect(screen.getByText(/Самостоятельная · День 1/)).toBeTruthy());
    expect(vi.mocked(getScheduleOccurrences)).not.toHaveBeenCalled();
  });

  it('keeps a device-only draft on the timeline and reopens its plan', async () => {
    state.localRows = [baseDraft];
    open();
    await waitFor(() => expect(screen.getByText(/Черновик · День 1/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Черновик · День 1/));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Запланировать тренировку' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByText(/Черновик · День 1/)).toBeTruthy();
  });

  it('removes the local draft only after the booking API confirms a real occurrence', async () => {
    state.localRows = [baseDraft];
    vi.mocked(confirmCloudWorkoutOccurrence).mockResolvedValue('occ-confirmed');
    open();
    fireEvent.click(await screen.findByText(/Черновик · День 1/));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByText(/Черновик · День 1/)).toBeNull());
    expect(vi.mocked(confirmCloudWorkoutOccurrence)).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Самостоятельная · День 1/)).toBeTruthy();
  });

  it('retires a confirmation after cloud observation so cancellation cannot resurrect it', async () => {
    state.localRows = [baseDraft];
    vi.mocked(confirmCloudWorkoutOccurrence).mockResolvedValue('occ-confirmed');
    open();
    fireEvent.click(await screen.findByText(/Черновик · День 1/));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByText(/Черновик · День 1/)).toBeNull());
    await act(async () => { state.calendarChanged?.([{ ...occurrence, id: 'occ-confirmed' }]); });
    expect(screen.getAllByText(/Самостоятельная · День 1/)).toHaveLength(1);
    await act(async () => { state.calendarChanged?.([]); });
    expect(screen.queryByText(/Самостоятельная · День 1/)).toBeNull();
  });

  it('does not recreate a confirmation if cloud observation and removal preceded the API receipt', async () => {
    state.localRows = [baseDraft];
    let confirm: (id: string) => void = () => {};
    vi.mocked(confirmCloudWorkoutOccurrence).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    open();
    fireEvent.click(await screen.findByText(/Черновик · День 1/));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(1));
    await act(async () => { state.calendarChanged?.([{ ...occurrence, id: 'occ-confirmed' }]); });
    await act(async () => { state.calendarChanged?.([]); });
    await act(async () => { confirm('occ-confirmed'); });
    await waitFor(() => expect(screen.queryByText(/Черновик · День 1/)).toBeNull());
    expect(screen.queryByText(/Самостоятельная · День 1/)).toBeNull();
  });

  it('retains the draft and editor when booking fails', async () => {
    state.localRows = [baseDraft];
    vi.mocked(confirmCloudWorkoutOccurrence).mockRejectedValue(new Error('Сеть недоступна'));
    open();
    fireEvent.click(await screen.findByText(/Черновик · День 1/));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText(/Черновик · День 1/)).toBeTruthy());
    expect(screen.getByRole('dialog', { name: 'Запланировать тренировку' })).toBeTruthy();
    expect(state.localRows).toHaveLength(1);
  });
});
