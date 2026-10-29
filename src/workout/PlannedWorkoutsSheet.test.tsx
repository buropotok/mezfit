// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpcomingPlannedWorkout } from '../data/cloud/planned-workouts';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { OccurrenceDraftCardProps } from '../schedule/OccurrenceDraftSheet';
import { PlannedWorkoutsSheet } from './PlannedWorkoutsSheet';
const state = vi.hoisted(() => ({ db: {}, next: null as ((rows: UpcomingPlannedWorkout[]) => void) | null,
  editorNext: null as ((draft: LocalWorkoutOccurrenceDraft | null) => void) | null, editorUnsubscribe: vi.fn(),
  unsubscribe: vi.fn(), start: vi.fn(), show: vi.fn(), cards: [] as OccurrenceDraftCardProps[] }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101' }) }));
vi.mock('../data/cloud/planned-workouts', () => ({ PlannedWorkoutsRepository: class {
  drafts = {};
  observeDraft(_id: string, next: (draft: LocalWorkoutOccurrenceDraft | null) => void) {
    state.editorNext = next;
    return { unsubscribe: state.editorUnsubscribe };
  }
  observe(_date: Date, next: (rows: UpcomingPlannedWorkout[]) => void) { state.next = next; return { unsubscribe: state.unsubscribe }; }
} }));
vi.mock('../data/cloud/workout-planning', () => ({ WorkoutPlanningRepository: class {} }));
vi.mock('./PlannedWorkoutStartContext', () => ({ usePlannedWorkoutStart: () => ({ start: state.start, showSession: state.show }) }));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
}));
vi.mock('konsta/react', () => ({ Toast: () => null, Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button> }));
vi.mock('../schedule/OccurrenceDraftSheet', () => ({
  useOccurrenceDraftClose: ({ onClose }: { onClose: () => void }) => ({ requestClose: onClose, closeDialog: null }),
  OccurrenceDraftCard: (props: OccurrenceDraftCardProps) => {
  state.cards.push(props);
  return <article><span>{props.draft?.plan.name}</span>
    <button onClick={props.onCollapsedChange}>{props.collapsed ? 'Раскрыть день' : 'Свернуть день'}</button>
    {!props.collapsed ? <button onClick={() => { if (props.draft) void props.onStart?.(props.draft); }}>Начать тренировку</button> : null}
  </article>;
} }));
const row: UpcomingPlannedWorkout = { id: 'original-occurrence', programName: 'Программа', draft: {
  id: 'draft:original-occurrence', targetOccurrenceId: 'original-occurrence', actorUserId: 'tg:101', realmId: 'tg:101',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent',
  startsAtUtc: '2026-10-27T10:00:00.000Z', durationMinutes: 60,
  plan: { name: 'День А', comment: null, exercises: [] }, originalPlan: { name: 'День А', comment: null, exercises: [] },
  createdAt: '', updatedAt: '',
} };
beforeEach(() => { vi.clearAllMocks(); state.cards = []; state.next = null; state.editorNext = null; state.start.mockResolvedValue('execution'); });
afterEach(cleanup);
it('reuses the original occurrence draft and shared editor across reactive updates and Start', async () => {
  const started = vi.fn();
  render(<PlannedWorkoutsSheet opened onClose={vi.fn()} onStarted={started} onNavigationContextChange={vi.fn()} />);
  expect(screen.getByText('Выберите запланированный день и настройте план.')).toBeTruthy();
  act(() => state.next?.([row]));
  expect(state.cards.at(-1)?.draft).toBe(row.draft);
  expect(state.cards.at(-1)?.collapsed).toBe(true);
  const changed = { ...row, draft: { ...row.draft, plan: { ...row.draft.plan, name: 'Изменено в расписании' } } };
  act(() => state.next?.([changed]));
  expect(screen.getByText('Изменено в расписании')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Раскрыть день' }));
  fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
  await waitFor(() => expect(started).toHaveBeenCalledWith('execution'));
  expect(state.start).toHaveBeenCalledExactlyOnceWith(changed.draft, expect.any(Function));
  expect(state.show).toHaveBeenCalledWith('execution');
});
it('unsubscribes and suppresses stale navigation after closing and reopening during Start', async () => {
  let resolve: (id: string) => void = () => {};
  state.start.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  const started = vi.fn();
  const props = { onClose: vi.fn(), onStarted: started, onNavigationContextChange: vi.fn() };
  const view = render(<PlannedWorkoutsSheet opened {...props} />);
  act(() => state.next?.([row]));
  fireEvent.click(screen.getByRole('button', { name: 'Раскрыть день' }));
  fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
  const isCurrent = state.start.mock.calls[0][1];
  expect(isCurrent()).toBe(true);
  view.rerender(<PlannedWorkoutsSheet opened={false} {...props} />);
  expect(isCurrent()).toBe(false);
  view.rerender(<PlannedWorkoutsSheet opened {...props} />);
  expect(isCurrent()).toBe(false);
  await act(async () => resolve('late'));
  expect(started).not.toHaveBeenCalled();
  expect(state.show).not.toHaveBeenCalled();
  expect(state.unsubscribe).toHaveBeenCalled();
});

it('retains only the already opened editor when its occurrence becomes a draft, and removes it on lost access', () => {
  render(<PlannedWorkoutsSheet opened onClose={vi.fn()} onStarted={vi.fn()} onNavigationContextChange={vi.fn()} />);
  act(() => state.next?.([row]));
  fireEvent.click(screen.getByRole('button', { name: 'Раскрыть день' }));
  const edited = { ...row.draft, saved: false, previouslyPublished: true, plan: { ...row.draft.plan, name: 'Правки дня' } };
  act(() => { state.next?.([]); state.editorNext?.(edited); });
  expect(screen.getByText('Правки дня')).toBeTruthy();
  expect(state.cards.at(-1)?.draft).toBe(edited);
  act(() => state.editorNext?.(null));
  expect(screen.queryByText('Правки дня')).toBeNull();
  expect(state.editorUnsubscribe).toHaveBeenCalled();
});
