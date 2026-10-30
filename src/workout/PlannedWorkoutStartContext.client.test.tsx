// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { PlannedWorkoutStartProvider, usePlannedWorkoutStart } from './PlannedWorkoutStartContext';
const state = vi.hoisted(() => ({ db: {}, enabled: true, create: vi.fn(), flush: vi.fn(), coachConstructed: vi.fn() }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:202' }) }));
vi.mock('./ClientWorkoutContext', () => {
  const repository = { createFromOccurrence: state.create };
  return { useClientWorkout: () => ({ repository: state.enabled ? repository : null }) };
});
vi.mock('../data/cloud/adhoc-workouts', () => ({ AdHocWorkoutRepository: class { constructor() { state.coachConstructed(); } } }));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({ WorkoutOccurrenceDraftRepository: class { flushEdits = state.flush; } }));
vi.mock('./PlannedWorkoutConflictSheet', () => ({ PlannedWorkoutConflictSheet: () => null }));
const draft: LocalWorkoutOccurrenceDraft = { id: 'draft:one', actorUserId: 'tg:202', realmId: 'shared',
  targetOccurrenceId: 'one', athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
  format: 'independent', startsAtUtc: '2026-10-29T08:00:00.000Z', durationMinutes: 60, saved: true,
  plan: { name: 'День', comment: null, exercises: [] }, originalPlan: { name: 'День', comment: null, exercises: [] },
  createdAt: '', updatedAt: '' };
function Trigger({ done, failed }: { done: (id: string) => void; failed: (error: unknown) => void }) {
  const start = usePlannedWorkoutStart();
  return <button disabled={!start} onClick={() => { void start?.start(draft).then(done, failed); }}>Start</button>;
}
beforeEach(() => { vi.clearAllMocks(); state.enabled = true; state.create.mockResolvedValue({ id: 'execution' }); });
afterEach(cleanup);
it('keeps the Client activity message and does not navigate on a blocked Start', async () => {
  state.create.mockRejectedValue(new Error('ADHOC_ACTIVE_SESSION_EXISTS'));
  const done = vi.fn(), failed = vi.fn();
  render(<PlannedWorkoutStartProvider role="client" onStarted={vi.fn()}><Trigger done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(screen.getByText('Завершите текущую тренировку, чтобы начать новую.')).toBeTruthy();
  expect(done).not.toHaveBeenCalled();
});
it('uses the Client repository without flushing or authoring assigned PLAN', async () => {
  const done = vi.fn(), failed = vi.fn();
  render(<PlannedWorkoutStartProvider role="client" onStarted={vi.fn()}><Trigger done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(done).toHaveBeenCalledWith('execution'));
  expect(state.create).toHaveBeenCalledWith('one');
  expect(state.flush).not.toHaveBeenCalled();
  expect(state.coachConstructed).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});
it('serializes Client Start intents while acceptance is pending', async () => {
  let finish!: (value: { id: string }) => void;
  state.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const done = vi.fn(), failed = vi.fn();
  render(<PlannedWorkoutStartProvider role="client" onStarted={vi.fn()}><Trigger done={done} failed={failed} /></PlannedWorkoutStartProvider>);
  fireEvent.click(screen.getByText('Start')); fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(state.create).toHaveBeenCalledOnce();
  await act(async () => finish({ id: 'one-session' }));
  expect(done).toHaveBeenCalledWith('one-session');
});
it('never falls back to Coach operations when Client storage is unavailable', () => {
  state.enabled = false;
  render(<PlannedWorkoutStartProvider role="client" onStarted={vi.fn()}><Trigger done={vi.fn()} failed={vi.fn()} /></PlannedWorkoutStartProvider>);
  expect((screen.getByText('Start') as HTMLButtonElement).disabled).toBe(true);
  expect(state.coachConstructed).not.toHaveBeenCalled();
});
