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
function Trigger({ done, failed }: { done: (id: string) => void; failed: (error: unknown) => void }) {
  const start = usePlannedWorkoutStart();
  return <button onClick={() => { void start?.start(draft).then(done, failed); }}>Начать</button>;
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
