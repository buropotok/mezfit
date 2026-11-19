// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlannedWorkoutStartProvider, usePlannedWorkoutStart } from './PlannedWorkoutStartContext';

const state = vi.hoisted(() => ({
  db: {},
  coachProgram: vi.fn(),
  coachIndependent: vi.fn(),
  clientProgram: vi.fn(),
  clientIndependent: vi.fn(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101' }),
}));
vi.mock('./ClientWorkoutContext', () => {
  const repository = {
    createForAthlete: state.clientProgram,
    createIndependentFromProgramDay: state.clientIndependent,
  };
  return { useClientWorkout: () => ({ repository }) };
});
vi.mock('../data/cloud/adhoc-workouts', () => ({
  AdHocWorkoutRepository: class {
    createForAthlete = state.coachProgram;
    createIndependentFromProgramDay = state.coachIndependent;
  },
}));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({
  WorkoutOccurrenceDraftRepository: class {},
}));
vi.mock('./PlannedWorkoutConflictSheet', () => ({ PlannedWorkoutConflictSheet: () => null }));

function StartDirect({ done, failed }: {
  done: (value: { id: string; createdProgram: boolean }) => void; failed: (reason: unknown) => void;
}) {
  const start = usePlannedWorkoutStart();
  return <button onClick={() => {
    void start?.startFromProgram({ athleteUserId: 'tg:202', programId: 'program',
      dayId: 'day', sourceDayStart: true }).then(done, failed);
  }}>Начать тренировку</button>;
}
const completed = { id: 'fact', createdProgram: false };

beforeEach(() => {
  vi.resetAllMocks();
  state.coachProgram.mockResolvedValue(completed);
  state.clientIndependent.mockResolvedValue(completed);
});
afterEach(cleanup);

describe('direct Start from a program day uses the actor role', () => {
  it('routes Coach mode to the existing coached session creator, not the independent creator', async () => {
    const done = vi.fn(), failed = vi.fn();
    render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}>
      <StartDirect done={done} failed={failed} />
    </PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(completed));
    expect(state.coachProgram).toHaveBeenCalledOnce();
    expect(state.coachProgram).toHaveBeenCalledWith('tg:202', 'program', 'day');
    expect(state.coachIndependent).not.toHaveBeenCalled();
    expect(state.clientIndependent).not.toHaveBeenCalled();
    expect(state.clientProgram).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it('routes Client mode to independent FACT without invoking Coach program authoring', async () => {
    const done = vi.fn(), failed = vi.fn();
    render(<PlannedWorkoutStartProvider role="client" onStarted={vi.fn()}>
      <StartDirect done={done} failed={failed} />
    </PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(completed));
    expect(state.clientIndependent).toHaveBeenCalledOnce();
    expect(state.clientIndependent).toHaveBeenCalledWith('tg:202', 'program', 'day');
    expect(state.clientProgram).not.toHaveBeenCalled();
    expect(state.coachProgram).not.toHaveBeenCalled();
    expect(state.coachIndependent).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it('propagates Coach start failures rather than falling back to an independent session', async () => {
    const done = vi.fn(), failed = vi.fn();
    const problem = new Error('ADHOC_ATHLETE_ACTIVE');
    state.coachProgram.mockRejectedValue(problem);
    render(<PlannedWorkoutStartProvider role="coach" onStarted={vi.fn()}>
      <StartDirect done={done} failed={failed} />
    </PlannedWorkoutStartProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(failed).toHaveBeenCalledWith(problem));
    expect(state.coachIndependent).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});
