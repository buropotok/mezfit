// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { relationshipMembership } from '../../worker/lib/dexie-cloud-membership';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { DayScheduleEventMove, DayScheduleEventResize, DayScheduleEventDelete } from '../ui';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { WorkoutOccurrenceDraftRepository as Repository } from '../data/cloud/workout-occurrence-drafts';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { TodayPage } from './TodayPage';
const state = vi.hoisted(() => ({ db: null as MezfitCloudDatabase | null,
  move: null as null | ((value: DayScheduleEventMove) => void),
  resize: null as null | ((value: DayScheduleEventResize) => void),
  remove: null as null | ((value: DayScheduleEventDelete) => void), eventId: '',
  planning: null as null | { requestedDraftId: string | null; requestedClientUserId: string | null; viewResetKey?: number; clearDraft: () => void; openDraft: () => void },
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: state.db, actorUserId: 'tg:101', clients: [], coaches: [], syncStatus: 'offline',
}) }));
vi.mock('./SchedulePlanningContext', () => ({ useSchedulePlanning: () => state.planning }));
vi.mock('./OccurrenceDraftSheet', () => ({ OccurrenceDraftSheet: ({ draft, drafts, onSave, onClose, saveNotice }: {
  draft: LocalWorkoutOccurrenceDraft | null; drafts: WorkoutOccurrenceDraftRepository; saveNotice?: string;
  onSave: (draft: LocalWorkoutOccurrenceDraft, update: boolean) => Promise<void>; onClose: () => void;
}) => draft ? <div role="dialog">
  {saveNotice ? <span role="alert">{saveNotice}</span> : null}
  <span>{draft.saved ? 'Сохранённая тренировка' : 'Редактируется черновик'}</span>
  <button onClick={() => { void drafts.enqueueEdit(draft.id, row => ({ ...row, plan: { ...row.plan, name: 'Новый план' } })); }}>Изменить план</button>
  <button onClick={() => { void drafts.enqueueEdit(draft.id, row => ({ ...row, durationMinutes: 90 })); }}>Изменить время</button>
  {!draft.saved ? <>
    <button onClick={() => { void onSave(draft, false); }}>Сохранить</button>
    <button onClick={() => { void onSave(draft, true); }}>Сохранить и обновить программу</button>
  </> : null}
  <button onClick={onClose}>Закрыть</button>
</div> : null }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  DaySchedule: ({ eventsByDate, renderEvent, onEventMove, onEventResize, onEventDelete, isEventEditable }: {
    eventsByDate: Record<string, Array<{ id: string; startMinutes: number; durationMinutes: number }>>;
    renderEvent: (event: { id: string; startMinutes: number; durationMinutes: number }, state: unknown) => ReactNode;
    isEventEditable: (event: { id: string; startMinutes: number; durationMinutes: number }) => boolean;
    onEventMove: typeof state.move; onEventResize: typeof state.resize; onEventDelete: typeof state.remove;
  }) => {
    const events = Object.values(eventsByDate).flat(); state.eventId = events[0]?.id ?? '';
    state.move = onEventMove; state.resize = onEventResize; state.remove = onEventDelete;
    return <div>{events.map(event => <div key={event.id} data-testid="segment" data-event-id={event.id} data-start={event.startMinutes} data-duration={event.durationMinutes} data-editable={isEventEditable(event)}>
      {renderEvent(event, { startMinutes: event.startMinutes, durationMinutes: event.durationMinutes, compact: false })}
    </div>)}</div>;
  },
  DayScheduleEventCard: ({ title, detail, status, onClick }: { title: ReactNode; detail: ReactNode; status: ReactNode; onClick: () => void }) =>
    <button onClick={onClick}>{title} {status} {detail}</button>,
}));
const plan = { name: 'День 1', comment: null, exercises: [] };
const draft: LocalWorkoutOccurrenceDraft = { id: 'draft:first', actorUserId: 'tg:101', realmId: 'tg:101',
  trainingPlanId: 'program', programDayId: 'day', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60, plan, originalPlan: plan,
  createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
let db: Dexie;
const repo = () => new Repository(state.db!, 'tg:101');
const open = () => render(<TodayPage initData="" role="coach" onNavigationContextChange={vi.fn()} />);
beforeEach(() => {
  db = new Dexie('today-local-' + crypto.randomUUID());
  db.version(1).stores({ localWorkoutOccurrenceDrafts: 'id', workoutOccurrences: 'id, realmId',
    localWorkoutSync: 'id', realms: 'realmId', members: 'id, realmId' });
  db.table('workoutOccurrences').hook('creating', (key, row) => {
    if (!key) { row.id = 'occ' + crypto.randomUUID().replaceAll('-', ''); return row.id; }
  });
  state.db = db as MezfitCloudDatabase; state.planning = null;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.stubEnv('TZ', 'UTC');
});
afterEach(async () => { cleanup(); await db.delete(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('local-first calendar experience', () => {
  it.each(['independent', 'coached'] as const)('keeps a client %s card visible after Save and after reopening', async format => {
    const pair = await relationshipMembership('101', '202');
    await db.table('realms').put(pair.realm); await db.table('members').bulkPut(pair.members);
    const createdId = await repo().create({ ...draft, realmId: pair.realm.realmId, athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format });
    state.planning = { requestedDraftId: createdId, requestedClientUserId: format === 'independent' ? 'tg:202' : null, clearDraft: () => { if (state.planning) state.planning.requestedDraftId = null; }, openDraft: () => {} };
    const page = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Сохранённая тренировка')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByRole('button', { name: /День 1/ })).toBeTruthy();
    expect(screen.queryByText('Черновик')).toBeNull();
    expect(await repo().list()).toEqual([]);
    if (format === 'independent' && state.planning) {
      state.planning.viewResetKey = 1;
      page.rerender(<TodayPage initData="" role="coach" onNavigationContextChange={vi.fn()} />);
      await waitFor(() => expect(screen.queryByTestId('segment')).toBeNull());
    }
    page.unmount(); state.planning = null; open();
    if (format === 'coached') expect(await screen.findByRole('button', { name: /День 1/ })).toBeTruthy();
    else await waitFor(() => expect(screen.queryByTestId('segment')).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a source-program failure visible after the saved editor remounts and closes', async () => {
    let rejectUpdate: (reason: Error) => void = () => {};
    const update = new Promise<void>((_, reject) => { rejectUpdate = reject; });
    vi.spyOn(ProgramManagementRepository.prototype, 'applyOccurrencePlan').mockImplementation(() => update);
    draft.id = await repo().create(draft);
    open(); fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и обновить программу' }));
    expect(await screen.findByText('Сохранённая тренировка')).toBeTruthy();
    await act(async () => { rejectUpdate(new Error('Исходный день изменён')); });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Тренировка сохранена. Программа не обновлена: Исходный день изменён');
    expect(await repo().list()).toEqual([]);
    expect(await db.table('workoutOccurrences').count()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    // The result outlives the sheet and subsequent successful calendar observations.
    const [row] = await db.table('workoutOccurrences').toArray();
    await act(async () => { await db.table('workoutOccurrences').update(row.id, { durationMinutes: 90 }); });
    expect(screen.getByRole('alert').textContent).toContain('Программа не обновлена');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens saved content without a draft and converts only content edits to a draft', async () => {
    draft.id = await repo().create(draft); const id = await repo().save(draft.id);
    open(); fireEvent.click(await screen.findByRole('button', { name: /Вы.*День 1/ }));
    expect(await screen.findByText('Сохранённая тренировка')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(await repo().list()).toEqual([]);
    fireEvent.click(screen.getByText('Изменить время'));
    await waitFor(async () => expect((await db.table('workoutOccurrences').get(id)).durationMinutes).toBe(90));
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    fireEvent.click(screen.getByText('Изменить план'));
    expect(await screen.findByRole('button', { name: 'Сохранить' })).toBeTruthy();
    expect(await db.table('workoutOccurrences').get(id)).toMatchObject({ publicationStatus: 'draft', plan: { name: 'Новый план' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull());
    expect((await db.table('workoutOccurrences').get(id)).plan.name).toBe('Новый план');
    expect(await db.table('workoutOccurrences').count()).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saves a new draft offline and reopens it as a saved workout', async () => {
    draft.id = await repo().create(draft);
    const view = open(); fireEvent.click(await screen.findByText('Черновик'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Сохранённая тренировка')).toBeTruthy();
    expect(screen.queryByText('Черновик')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    view.unmount(); open();
    fireEvent.click(await screen.findByRole('button', { name: /Вы.*День 1/ }));
    expect(await screen.findByText('Сохранённая тренировка')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the drop position immediately while Dexie is pending and preserves identity across days', async () => {
    draft.id = await repo().create(draft); const id = await repo().save(draft.id); open();
    await screen.findByRole('button', { name: /Вы.*День 1/ });
    const eventId = state.eventId;
    const original = Repository.prototype.enqueueEdit;
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(Repository.prototype, 'enqueueEdit').mockImplementation(async function (this: Repository, ...args) {
      await pending; await original.apply(this, args);
    });
    act(() => { state.move?.({ eventId, date: '2026-10-19', targetDate: '2026-10-20', previousStartMinutes: 480, startMinutes: 600 }); });
    expect(screen.getByTestId('segment').getAttribute('data-start')).toBe('600');
    expect(screen.getByTestId('segment').getAttribute('data-event-id')).toBe(eventId);
    expect(screen.getByTestId('segment').getAttribute('data-editable')).toBe('true');
    expect((await db.table('workoutOccurrences').get(id)).startsAtUtc).toBe(draft.startsAtUtc);
    await act(async () => { finish(); });
    await waitFor(async () => expect((await db.table('workoutOccurrences').get(id)).startsAtUtc).toBe('2026-10-20T10:00:00.000Z'));
    expect(screen.getByTestId('segment').getAttribute('data-start')).toBe('600');
    // Extend the same booking upwards, retaining its end time and saved status.
    act(() => { state.resize?.({ eventId, date: '2026-10-20', previousStartMinutes: 600, startMinutes: 585, previousDurationMinutes: 60, durationMinutes: 75 }); });
    await waitFor(async () => expect(await db.table('workoutOccurrences').get(id)).toMatchObject({ startsAtUtc: '2026-10-20T09:45:00.000Z', durationMinutes: 75 }));
    expect(screen.queryByText('Черновик')).toBeNull();
  });

  it('rolls a refused drop back visibly instead of retaining an optimistic booking', async () => {
    draft.id = await repo().create(draft); await repo().save(draft.id); open();
    await screen.findByRole('button', { name: /Вы.*День 1/ });
    vi.spyOn(Repository.prototype, 'enqueueEdit').mockRejectedValueOnce(new Error('Это время занято'));
    await act(async () => { state.move?.({ eventId: state.eventId, date: '2026-10-19', targetDate: '2026-10-19', previousStartMinutes: 480, startMinutes: 600 }); });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Это время занято');
    expect(screen.getByTestId('segment').getAttribute('data-start')).toBe('480');
  });

  it('moves and resizes saved workouts without creating a draft or calling an API', async () => {
    draft.id = await repo().create(draft); const id = await repo().save(draft.id); open();
    await screen.findByRole('button', { name: /Вы.*День 1/ });
    await act(async () => { state.move?.({ eventId: state.eventId, date: '2026-10-19', targetDate: '2026-10-20', previousStartMinutes: 480, startMinutes: 600 }); });
    await waitFor(async () => expect((await db.table('workoutOccurrences').get(id)).startsAtUtc).toBe('2026-10-20T10:00:00.000Z'));
    await act(async () => { state.resize?.({ eventId: state.eventId, date: '2026-10-20', previousStartMinutes: 600, startMinutes: 600, previousDurationMinutes: 60, durationMinutes: 90 }); });
    await waitFor(async () => expect((await db.table('workoutOccurrences').get(id)).durationMinutes).toBe(90));
    expect(await repo().list()).toEqual([]); expect(screen.queryByText('Черновик')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['UTC', '2026-10-19T23:30:00.000Z', 120],
    ['Europe/Berlin', '2026-03-29T00:30:00.000Z', 180],
    ['Europe/Berlin', '2026-10-24T23:30:00.000Z', 180],
  ] as const)('keeps split drafts readable without unsafe segment gestures (%s, %s)', async (zone, start, duration) => {
    vi.stubEnv('TZ', zone);
    await repo().create({ ...draft, startsAtUtc: String(start), durationMinutes: Number(duration) });
    open(); const segments = await screen.findAllByTestId('segment'); expect(segments).toHaveLength(2);
    for (const segment of segments) expect(segment.getAttribute('data-editable')).toBe('false');
    fireEvent.click(screen.getAllByText('Черновик')[1]);
    expect(await screen.findByRole('button', { name: 'Сохранить' })).toBeTruthy();
  });
});
