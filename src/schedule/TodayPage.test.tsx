// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayScheduleEventMove, DayScheduleEventResize, DayScheduleEventDelete, LocalDate } from '../ui';
import type { ReactNode } from 'react';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { ApiError, confirmCloudWorkoutOccurrence, getScheduleOccurrences } from '../api';
import { assertLocalWorkoutSlot } from '../data/cloud/workout-slot-validation';
import { TodayPage } from './TodayPage';

vi.mock('../data/cloud/workout-slot-validation', () => ({ assertLocalWorkoutSlot: vi.fn(async () => {}) }));

const state = vi.hoisted(() => ({
  cloudRows: [] as CloudWorkoutOccurrenceRow[],
  localRows: [] as LocalWorkoutOccurrenceDraft[],
  calendarChanged: null as null | ((rows: CloudWorkoutOccurrenceRow[]) => void),
  draftsChanged: null as null | ((rows: LocalWorkoutOccurrenceDraft[]) => void),
  requestedDraftId: null as string | null,
  actorUserId: 'tg:101',
  db: {},
  closed: 0,
  move: null as null | ((event: DayScheduleEventMove) => void),
  resize: null as null | ((event: DayScheduleEventResize) => void),
  remove: null as null | ((event: DayScheduleEventDelete) => void),
  eventId: '',
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
    async create(draft: LocalWorkoutOccurrenceDraft) { state.localRows.push(draft); state.draftsChanged?.([...state.localRows]); return draft.id; }
    async get(id: string) { return state.localRows.find(row => row.id === id) ?? null; }
    async prepareSubmission(id: string) {
      const current = state.localRows.find(row => row.id === id);
      if (!current) throw new Error('Черновик не найден');
      const isNewSubmission = !current.submissionPending;
      current.submissionPending = true;
      state.draftsChanged?.([...state.localRows]);
      return { draft: structuredClone(current), isNewSubmission };
    }
    async releaseSubmission(id: string) {
      const current = state.localRows.find(row => row.id === id);
      if (current) current.submissionPending = false;
    }
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
  DaySchedule: ({ eventsByDate, renderEvent, onEventMove, onEventResize, onEventDelete, isEventEditable }: {
    onEventMove?: (event: DayScheduleEventMove) => void;
    onEventResize?: (event: DayScheduleEventResize) => void;
    onEventDelete?: (event: DayScheduleEventDelete) => void;
    isEventEditable?: (item: { id: string; startMinutes: number; durationMinutes: number }) => boolean;
    eventsByDate: Record<string, Array<{ id: string; startMinutes: number; durationMinutes: number }>>;
    renderEvent: (item: { id: string; startMinutes: number; durationMinutes: number }, state: unknown) => ReactNode;
  }) => {
    state.move = onEventMove ?? null; state.resize = onEventResize ?? null; state.remove = onEventDelete ?? null;
    state.eventId = Object.values(eventsByDate).flat()[0]?.id ?? '';
    return <div data-testid="calendar">
    {Object.values(eventsByDate).flat().map(item => (
      <div key={item.id} data-testid="timeline-segment" data-editable={isEventEditable?.(item)}>{renderEvent(item, {
        startMinutes: item.startMinutes, durationMinutes: item.durationMinutes,
        compact: false, editing: false, lifted: false,
      })}</div>
    ))}
  </div>; },
  DayScheduleEventCard: ({ title, detail, status, onClick }: {
    title: ReactNode; detail?: ReactNode; status?: ReactNode; onClick?: () => void;
  }) => <button onClick={onClick}>{title} {status} {detail}</button>,
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
  vi.mocked(assertLocalWorkoutSlot).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
const open = () => render(<TodayPage initData="telegram-session" role="coach" currentUserId={101}
  onNavigationContextChange={vi.fn()} />);

describe('Dexie-backed schedule', () => {
  it.each([
    ['midnight', 'UTC', '2026-10-19T23:30:00.000Z', 120],
    ['spring offset change', 'Europe/Berlin', '2026-03-29T00:30:00.000Z', 180],
    ['autumn offset change', 'Europe/Berlin', '2026-10-24T23:30:00.000Z', 180],
  ] as const)('keeps every draft segment across %s out of timeline gestures but opens the whole interval', async (_case, zone, startsAtUtc, durationMinutes) => {
    vi.stubEnv('TZ', zone);
    state.localRows = [{ ...structuredClone(baseDraft), startsAtUtc, durationMinutes }];
    open();
    const segments = await screen.findAllByTestId('timeline-segment');
    expect(segments).toHaveLength(2);
    for (const segment of segments) expect(segment.getAttribute('data-editable')).toBe('false');
    // The later segment must still open the same complete draft, without rewriting its timing.
    fireEvent.click(screen.getAllByRole('button', { name: /Вы.*Черновик.*День 1/ })[1]);
    expect(await screen.findByRole('dialog', { name: 'Запланировать тренировку' })).toBeTruthy();
    expect(state.localRows).toHaveLength(1);
    expect(state.localRows[0]).toMatchObject({ id: baseDraft.id, startsAtUtc, durationMinutes });
    expect(confirmCloudWorkoutOccurrence).not.toHaveBeenCalled();
  });

  it.each([false, true])('allows whole-draft timeline gestures only before submission (pending=%s)', async submissionPending => {
    vi.stubEnv('TZ', 'UTC');
    state.localRows = [{ ...structuredClone(baseDraft), submissionPending }];
    open();
    const segment = await screen.findByTestId('timeline-segment');
    expect(segment.getAttribute('data-editable')).toBe(String(!submissionPending));
  });

  it('does not unlock an earlier ambiguous submission after a later refusal', async () => {
    state.localRows = [structuredClone(baseDraft)];
    vi.mocked(confirmCloudWorkoutOccurrence).mockRejectedValueOnce(new Error('Ответ потерян'))
      .mockRejectedValueOnce(new ApiError(403, 'Нет доступа', 'SCHEDULE_FORBIDDEN'));
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(2));
    expect(state.localRows[0].submissionPending).toBe(true);
  });

  it('retries the persisted identical command after an ambiguous HTTP failure', async () => {
    state.localRows = [structuredClone(baseDraft)];
    vi.mocked(confirmCloudWorkoutOccurrence).mockRejectedValueOnce(new Error('Ответ потерян'))
      .mockResolvedValueOnce('occ-confirmed');
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(1));
    expect(state.localRows[0].submissionPending).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByText('Черновик')).toBeNull());
    expect(vi.mocked(confirmCloudWorkoutOccurrence).mock.calls[1][1])
      .toEqual(vi.mocked(confirmCloudWorkoutOccurrence).mock.calls[0][1]);
  });

  it('opens a saved workout and updates that occurrence instead of creating a second one', async () => {
    state.cloudRows = [occurrence];
    vi.mocked(confirmCloudWorkoutOccurrence).mockResolvedValue(occurrence.id);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Вы.*День 1/ }));
    await waitFor(() => expect(state.localRows[0]?.targetOccurrenceId).toBe(occurrence.id));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(1));
    expect(vi.mocked(confirmCloudWorkoutOccurrence).mock.calls[0][1].targetOccurrenceId).toBe(occurrence.id);
    await waitFor(() => expect(state.localRows).toHaveLength(0));
    expect(screen.getAllByRole('button', { name: /Вы.*День 1/ })).toHaveLength(1);
  });

  it('connects timeline move, resize and deletion to existing-occurrence mutations', async () => {
    vi.stubEnv('TZ', 'UTC');
    state.cloudRows = [occurrence];
    vi.mocked(confirmCloudWorkoutOccurrence).mockResolvedValue(occurrence.id);
    open();
    await waitFor(() => expect(state.move).not.toBeNull());
    await act(async () => { state.move?.({ eventId: state.eventId, date: '2026-10-19' as LocalDate,
      targetDate: '2026-10-20' as LocalDate, previousStartMinutes: 480, startMinutes: 600 }); });
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(1));
    expect(vi.mocked(confirmCloudWorkoutOccurrence).mock.calls[0][1])
      .toMatchObject({ targetOccurrenceId: occurrence.id, startsAtUtc: '2026-10-20T10:00:00.000Z' });
    await waitFor(() => expect(state.localRows).toHaveLength(0));
    await act(async () => { state.resize?.({ eventId: state.eventId, date: '2026-10-20' as LocalDate,
      previousStartMinutes: 600, startMinutes: 600, previousDurationMinutes: 60, durationMinutes: 90 }); });
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(2));
    expect(vi.mocked(confirmCloudWorkoutOccurrence).mock.calls[1][1].durationMinutes).toBe(90);
    await waitFor(() => expect(state.localRows).toHaveLength(0));
    await act(async () => { state.remove?.({ eventId: state.eventId, date: '2026-10-20' as LocalDate }); });
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(3));
    expect(vi.mocked(confirmCloudWorkoutOccurrence).mock.calls[2][1].cancelRequested).toBe(true);
  });

  it('does not submit a booking which failed the local occupancy check', async () => {
    state.localRows = [structuredClone(baseDraft)];
    vi.mocked(assertLocalWorkoutSlot).mockRejectedValueOnce(new Error('Время занято'));
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(assertLocalWorkoutSlot).toHaveBeenCalledTimes(1));
    expect(confirmCloudWorkoutOccurrence).not.toHaveBeenCalled();
    expect(state.localRows).toHaveLength(1);
  });

  it('renders confirmed occurrences without fetching obsolete D1 calendar rows', async () => {
    state.cloudRows = [occurrence];
    open();
    await waitFor(() => expect(screen.getByRole('button', { name: /Вы.*День 1/ })).toBeTruthy());
    expect(vi.mocked(getScheduleOccurrences)).not.toHaveBeenCalled();
  });

  it('keeps a device-only draft on the timeline and reopens its plan', async () => {
    state.localRows = [structuredClone(baseDraft)];
    open();
    await waitFor(() => expect(screen.getByText('Черновик')).toBeTruthy());
    fireEvent.click(screen.getByText('Черновик'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Запланировать тренировку' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByText('Черновик')).toBeTruthy();
  });

  it('removes the local draft only after the booking API confirms a real occurrence', async () => {
    state.localRows = [structuredClone(baseDraft)];
    vi.mocked(confirmCloudWorkoutOccurrence).mockResolvedValue('occ-confirmed');
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByText('Черновик')).toBeNull());
    expect(vi.mocked(confirmCloudWorkoutOccurrence)).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Вы.*День 1/ })).toBeTruthy();
  });

  it('retires a confirmation after cloud observation so cancellation cannot resurrect it', async () => {
    state.localRows = [structuredClone(baseDraft)];
    vi.mocked(confirmCloudWorkoutOccurrence).mockResolvedValue('occ-confirmed');
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByText('Черновик')).toBeNull());
    await act(async () => { state.calendarChanged?.([{ ...occurrence, id: 'occ-confirmed' }]); });
    expect(screen.getAllByRole('button', { name: /Вы.*День 1/ })).toHaveLength(1);
    await act(async () => { state.calendarChanged?.([]); });
    expect(screen.queryByRole('button', { name: /Вы.*День 1/ })).toBeNull();
  });

  it('does not recreate a confirmation if cloud observation and removal preceded the API receipt', async () => {
    state.localRows = [structuredClone(baseDraft)];
    let confirm: (id: string) => void = () => {};
    vi.mocked(confirmCloudWorkoutOccurrence).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(confirmCloudWorkoutOccurrence).toHaveBeenCalledTimes(1));
    await act(async () => { state.calendarChanged?.([{ ...occurrence, id: 'occ-confirmed' }]); });
    await act(async () => { state.calendarChanged?.([]); });
    await act(async () => { confirm('occ-confirmed'); });
    await waitFor(() => expect(screen.queryByText('Черновик')).toBeNull());
    expect(screen.queryByRole('button', { name: /Вы.*День 1/ })).toBeNull();
  });

  it('retains the draft and editor when booking fails', async () => {
    state.localRows = [structuredClone(baseDraft)];
    vi.mocked(confirmCloudWorkoutOccurrence).mockRejectedValue(new Error('Сеть недоступна'));
    open();
    fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText('Черновик')).toBeTruthy());
    expect(screen.getByRole('dialog', { name: 'Запланировать тренировку' })).toBeTruthy();
    expect(state.localRows).toHaveLength(1);
  });
});
