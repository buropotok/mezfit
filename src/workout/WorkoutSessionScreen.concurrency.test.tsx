// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeWorkoutSession,
  initializeWorkoutSession,
  reorderWorkoutSessionExercises,
  saveWorkoutSessionSet,
  startWorkoutSession,
} from '../api';
import { WorkoutSessionScreen } from './WorkoutSessionScreen';
import type { SessionExerciseData } from './sessionExerciseTypes';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

vi.mock('../api', () => ({
  completeWorkoutSession: vi.fn(),
  initializeWorkoutSession: vi.fn(),
  reorderWorkoutSessionExercises: vi.fn(),
  saveWorkoutSessionSet: vi.fn(),
  startWorkoutSession: vi.fn(),
}));

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  type SortableListProps = React.ComponentProps<typeof actual.SortableList>;

  function TestSortableList({ items, onReorder }: SortableListProps) {
    return (
      <div>
        <button type="button" onClick={() => onReorder([...items].reverse())}>Reverse exercises</button>
        <div data-testid="sortable-order">{items.map((item) => String(item.id)).join(',')}</div>
        {items.map((item) => <div key={item.id}>{item.content}</div>)}
      </div>
    );
  }

  return { ...actual, SortableList: TestSortableList };
});

const initializeMock = vi.mocked(initializeWorkoutSession);
const saveSetMock = vi.mocked(saveWorkoutSessionSet);
const reorderMock = vi.mocked(reorderWorkoutSessionExercises);
const startMock = vi.mocked(startWorkoutSession);
const completeMock = vi.mocked(completeWorkoutSession);

function exerciseData(id: number, position: number, withSet: boolean): SessionExerciseData {
  return {
    sessionExerciseId: id,
    workoutSessionId: 700,
    sourceProgramExerciseId: null,
    position,
    status: 'active',
    notes: null,
    exercise: {
      id,
      scope: 'global',
      name: `Exercise ${id}`,
      description: null,
      tracking_type: 'weight_reps',
      category_code: 'chest',
      equipment_code: 'barbell',
      reference_source: null,
      reference_key: null,
      reference_media_url: null,
      is_favourite: false,
      can_edit: false,
    },
    sets: withSet ? [{
      sessionSetId: 900,
      sourceProgramSetId: null,
      position: 0,
      status: 'pending',
      plan: { weightKg: 50, reps: 8, durationSeconds: null, distanceMeters: null },
      previous: null,
      fact: null,
    }] : [],
  };
}

const initialSession: ActiveWorkoutSession = {
  sessionId: 700,
  status: 'active',
  workoutDate: '2026-09-16',
  program: null,
  phase: null,
  day: null,
  exercises: [exerciseData(1, 0, true), exerciseData(2, 1, false)],
};

const reorderedSession: ActiveWorkoutSession = {
  ...initialSession,
  exercises: [
    { ...initialSession.exercises[1], position: 0 },
    { ...initialSession.exercises[0], position: 1 },
  ],
};

const finalSession: ActiveWorkoutSession = {
  ...reorderedSession,
  exercises: reorderedSession.exercises.map((exercise) => exercise.sessionExerciseId === 1 ? {
    ...exercise,
    sets: exercise.sets.map((set) => ({
      ...set,
      status: 'completed',
      fact: {
        metrics: { weightKg: 50, reps: 8, durationSeconds: null, distanceMeters: null },
        setLabel: null,
        rpe: null,
        comment: null,
        bands: [],
      },
    })),
  } : exercise),
};

beforeEach(() => {
  initializeMock.mockReset();
  saveSetMock.mockReset();
  reorderMock.mockReset();
  startMock.mockReset();
  completeMock.mockReset();
});

afterEach(cleanup);

describe('WorkoutSessionScreen mutation reconciliation', () => {
  it('serializes a set save behind an in-flight reorder and preserves the canonical order', async () => {
    initializeMock.mockResolvedValue({ session: initialSession });
    let resolveSave: (value: { session: ActiveWorkoutSession }) => void = () => undefined;
    let resolveReorder: (value: { session: ActiveWorkoutSession }) => void = () => undefined;
    saveSetMock.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    reorderMock.mockReturnValue(new Promise((resolve) => { resolveReorder = resolve; }));

    render(
      <WorkoutSessionScreen
        initData="telegram-init"
        onClose={vi.fn()}
      />,
    );

    expect((await screen.findByTestId('sortable-order')).textContent).toBe('1,2');
    fireEvent.click(screen.getByRole('button', { name: 'Reverse exercises' }));
    expect(screen.getByTestId('sortable-order').textContent).toBe('2,1');
    await waitFor(() => expect(reorderMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    expect(saveSetMock).not.toHaveBeenCalled();

    await act(async () => resolveReorder({ session: reorderedSession }));
    await waitFor(() => expect(saveSetMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('sortable-order').textContent).toBe('2,1');

    await act(async () => resolveSave({ session: finalSession }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Подход 1' })).toBeNull());
    expect(screen.getByTestId('sortable-order').textContent).toBe('2,1');
  });
});
