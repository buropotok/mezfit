// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { PlannedWorkoutConflict } from '../data/cloud/planned-workout-conflicts';
import { PlannedWorkoutStartProvider, usePlannedWorkoutStart } from './PlannedWorkoutStartContext';

const state = vi.hoisted(() => ({ db: {}, create: vi.fn(), cancel: vi.fn(), flush: vi.fn(), closed: null as null | (() => void) }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101' }) }));
vi.mock('../data/cloud/adhoc-workouts', () => ({ AdHocWorkoutRepository: class { createFromOccurrence = state.create; } }));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({ WorkoutOccurrenceDraftRepository: class { cancel = state.cancel; flushEdits = state.flush; } }));
vi.mock('./PlannedWorkoutConflictSheet', () => ({ PlannedWorkoutConflictSheet: (props: {
  opened: boolean; onDecision: (value: 'cancel' | 'back') => void; onClosed: () => void;
}) => {
  state.closed = props.onClosed;
  return props.opened ? <div role="dialog"><button onClick={() => props.onDecision('cancel')}>Отменить тренировку</button>
    <button onClick={() => props.onDecision('back')}>Назад</button></div> : null;
} }));
const draft: LocalWorkoutOccurrenceDraft = { id: 'draft:chosen', actorUserId: 'tg:101', realmId: 'pair',
  targetOccurrenceId: 'chosen', athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
  startsAtUtc: '2026-10-29T10:00:00.000Z', durationMinutes: 60,
  plan: { name: 'План', comment: null, exercises: [] }, originalPlan: { name: 'План', comment: null, exercises: [] },
  createdAt: '', updatedAt: '' };
const other: CloudWorkoutOccurrenceRow = { id: 'occupied', realmId: 'other-pair', owner: 'other-pair',
  athleteUserId: 'tg:303', coachUserId: 'tg:101', clientUserId: 'tg:303', format: 'coached',
  startsAtUtc: '2026-10-28T10:00:00.000Z', durationMinutes: 60, status: 'scheduled', workoutSessionId: null,
  plan: { name: 'Другая тренировка', comment: null, exercises: [] } };
function Trigger({ done, failed, isCurrent }: { done: (id: string) => void; failed: (error: unknown) => void; isCurrent?: () => boolean }) {
  const start = usePlannedWorkoutStart();
  return <button onClick={() => { void start?.start(draft, isCurrent).then(done, failed); }}>Начать</button>;
}
beforeEach(() => { vi.clearAllMocks(); state.create.mockRejectedValueOnce(new PlannedWorkoutConflict([other])).mockResolvedValue({ id: 'execution' }); state.cancel.mockResolvedValue(undefined); state.flush.mockResolvedValue(undefined); });
afterEach(cleanup);
describe('Start cancellation sequencing', () => {
  it('waits for the conflict Sheet to fully close, then cancels and retries Start', async () => {
    const done = vi.fn(), failed = vi.fn();
    render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger done={done} failed={failed} /></PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
    expect(state.cancel).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    await act(async () => state.closed?.());
    await waitFor(() => expect(done).toHaveBeenCalledWith('execution'));
    expect(state.cancel).toHaveBeenCalledWith('occupied');
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  });
  it('Back closes the decision without cancelling or creating a session', async () => {
    const done = vi.fn(), failed = vi.fn();
    render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger done={done} failed={failed} /></PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await act(async () => state.closed?.());
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(state.cancel).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it('a failed cancellation leaves Start rejected without retrying materialization', async () => {
    state.cancel.mockRejectedValueOnce(new Error('Нет места'));
    const done = vi.fn(), failed = vi.fn();
    render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger done={done} failed={failed} /></PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
    await act(async () => state.closed?.());
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(state.create).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
  });
});

describe('independent athlete workout Start confirmation', () => {
  const prompt = 'Начать тренировку в зале с клиентом?';
  function mount(isCurrent?: () => boolean) {
    state.create.mockReset().mockRejectedValueOnce(new Error('PLANNED_INDEPENDENT_REQUIRES_COACHING'))
      .mockResolvedValue({ id: 'execution' });
    const done = vi.fn(), failed = vi.fn();
    const view = render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}>
      <Trigger done={done} failed={failed} isCurrent={isCurrent} />
    </PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    return { ...view, done, failed };
  }
  it('waits for Yes, then explicitly requests conversion without a duplicate Start on double tap', async () => {
    const { done, failed } = mount();
    const dialog = await screen.findByRole('alertdialog', { name: prompt });
    expect(dialog.textContent).toContain('Вы не можете начать самостоятельную тренировку спортсмена.');
    expect(state.create).toHaveBeenCalledExactlyOnceWith('chosen');
    const yes = screen.getByRole('button', { name: 'Да' });
    fireEvent.click(yes); fireEvent.click(yes);
    await waitFor(() => expect(done).toHaveBeenCalledWith('execution'));
    expect(state.create).toHaveBeenLastCalledWith('chosen', { asCoached: true });
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  });
  it('No dismisses without conversion, cancellation or another creation attempt', async () => {
    const { done, failed } = mount();
    await screen.findByRole('alertdialog', { name: prompt });
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.cancel).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  });
  it('does not start after navigating away while the prompt is open', async () => {
    let current = true;
    const { done, failed } = mount(() => current);
    await screen.findByRole('alertdialog', { name: prompt });
    current = false;
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(state.create).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
  });
  it('settles the pending decision on unmount without creating execution', async () => {
    const { unmount, done, failed } = mount();
    await screen.findByRole('alertdialog', { name: prompt });
    unmount();
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(state.create).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
  });
  it('retains the existing conflict flow after Yes and retries with explicit conversion', async () => {
    const { done } = mount();
    state.create.mockReset().mockRejectedValueOnce(new Error('PLANNED_INDEPENDENT_REQUIRES_COACHING'))
      .mockRejectedValueOnce(new PlannedWorkoutConflict([other])).mockResolvedValue({ id: 'execution' });
    await screen.findByRole('alertdialog', { name: prompt });
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await screen.findByRole('button', { name: 'Отменить тренировку' });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
    await act(async () => state.closed?.());
    await waitFor(() => expect(done).toHaveBeenCalledWith('execution'));
    expect(state.cancel).toHaveBeenCalledWith('occupied');
    expect(state.create).toHaveBeenLastCalledWith('chosen', { asCoached: true });
  });
});
