// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { PlannedWorkoutConflict } from '../data/cloud/planned-workout-conflicts';
import { PlannedWorkoutStartProvider, usePlannedWorkoutStart } from './PlannedWorkoutStartContext';

const state = vi.hoisted(() => ({ quick: vi.fn(), program: vi.fn(), cancel: vi.fn(),
  closed: null as null | (() => void), current: true, db: {} }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101' }) }));
vi.mock('../data/cloud/adhoc-workouts', () => ({ AdHocWorkoutRepository: class {
  createQuick = state.quick; createForAthlete = state.program;
} }));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({ WorkoutOccurrenceDraftRepository: class { cancel = state.cancel; } }));
vi.mock('./PlannedWorkoutConflictSheet', () => ({ PlannedWorkoutConflictSheet: (props: {
  opened: boolean; onDecision: (value: 'cancel' | 'back') => void; onClosed: () => void;
}) => {
  state.closed = props.onClosed;
  return props.opened ? <div role="dialog"><button onClick={() => props.onDecision('cancel')}>Отменить тренировку</button>
    <button onClick={() => props.onDecision('back')}>Назад</button></div> : null;
} }));
const booking: CloudWorkoutOccurrenceRow = {
  id: 'occupied', owner: null, realmId: 'pair', athleteUserId: 'tg:303', coachUserId: 'tg:101', clientUserId: 'tg:303',
  format: 'coached', startsAtUtc: '2026-10-28T05:30:00.000Z', durationMinutes: 60,
  status: 'scheduled', workoutSessionId: null, plan: { name: 'Занято', comment: null, exercises: [] },
};
function Trigger({ kind, done, failed }: { kind: 'quick' | 'program'; done: (result: unknown) => void; failed: (reason: unknown) => void }) {
  const start = usePlannedWorkoutStart();
  return <button onClick={() => {
    const operation = kind === 'quick' ? start?.startQuick(() => state.current)
      : start?.startFromProgram({ athleteUserId: 'tg:202', programId: 'program', dayId: 'day' }, () => state.current);
    void operation?.then(done, failed);
  }}>Начать</button>;
}
beforeEach(() => {
  vi.resetAllMocks(); state.current = true;
  state.cancel.mockResolvedValue(undefined);
  for (const fn of [state.quick, state.program]) fn.mockRejectedValueOnce(new PlannedWorkoutConflict([booking]))
    .mockResolvedValue({ id: 'execution', createdProgram: false });
});
afterEach(cleanup);

it.each(['quick', 'program'] as const)('resolves %s conflicts only after Sheet close and cancellation presentation finish', async kind => {
  const done = vi.fn(), failed = vi.fn();
  let finish: (() => void) | undefined;
  state.cancel.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger kind={kind} done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
  expect(state.cancel).not.toHaveBeenCalled();
  await act(async () => state.closed?.());
  expect(state.cancel).toHaveBeenCalledWith('occupied');
  const create = kind === 'quick' ? state.quick : state.program;
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => finish?.());
  await waitFor(() => expect(done).toHaveBeenCalledWith({ id: 'execution', createdProgram: false }));
  expect(create).toHaveBeenCalledTimes(2);
  if (kind === 'program') expect(create).toHaveBeenLastCalledWith('tg:202', 'program', 'day');
  expect(failed).not.toHaveBeenCalled();
});
it.each(['quick', 'program'] as const)('Back abandons %s without cancelling the booking', async kind => {
  const done = vi.fn(), failed = vi.fn();
  render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger kind={kind} done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
  await act(async () => state.closed?.());
  await waitFor(() => expect(failed).toHaveBeenCalled());
  expect(state.cancel).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  expect(kind === 'quick' ? state.quick : state.program).toHaveBeenCalledTimes(1);
});
it('rechecks the initiating screen after cancellation so navigation does not create a late session', async () => {
  const done = vi.fn(), failed = vi.fn();
  let finish: (() => void) | undefined;
  state.cancel.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger kind="program" done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
  await act(async () => state.closed?.());
  state.current = false;
  await act(async () => finish?.());
  await waitFor(() => expect(failed).toHaveBeenCalled());
  expect(state.program).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
});
it('rechecks conflicts on every retry instead of assuming one cancellation cleared the calendar', async () => {
  state.quick.mockReset().mockRejectedValueOnce(new PlannedWorkoutConflict([booking]))
    .mockRejectedValueOnce(new PlannedWorkoutConflict([{ ...booking, id: 'second' }]))
    .mockResolvedValue({ id: 'execution', createdProgram: false });
  const done = vi.fn(), failed = vi.fn();
  render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger kind="quick" done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  for (const id of ['occupied', 'second']) {
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
    await act(async () => state.closed?.());
    expect(state.cancel).toHaveBeenCalledWith(id);
  }
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(state.quick).toHaveBeenCalledTimes(3);
});
it.each(['quick', 'program'] as const)('does not retry %s when cancellation fails', async kind => {
  state.cancel.mockRejectedValueOnce(new Error('Не удалось сохранить отмену'));
  const done = vi.fn(), failed = vi.fn();
  render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}><Trigger kind={kind} done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
  await act(async () => state.closed?.());
  await waitFor(() => expect(failed).toHaveBeenCalled());
  expect(kind === 'quick' ? state.quick : state.program).toHaveBeenCalledTimes(1);
  expect(done).not.toHaveBeenCalled();
});
