// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addWorkoutSessionExercises,
  completeWorkoutSession,
  getWorkoutExerciseOptions,
  initializeWorkoutSession,
  reorderWorkoutSessionExercises,
  saveWorkoutSessionSet,
  startWorkoutSession,
} from '../api';
import { WorkoutSessionScreen } from './WorkoutSessionScreen';
import type { SessionExerciseData } from './sessionExerciseTypes';
import type { ActiveWorkoutSession, DraftWorkoutSession } from './workoutSessionTypes';

vi.mock('../api', () => ({
  addWorkoutSessionExercises: vi.fn(),
  completeWorkoutSession: vi.fn(),
  getWorkoutExerciseOptions: vi.fn(),
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
        <button
          type="button"
          onClick={() => {
            const [first, ...rest] = items;
            if (first) onReorder([...rest, first]);
          }}
        >
          Rotate exercises
        </button>
        <div data-testid="sortable-order">{items.map((item) => String(item.id)).join(',')}</div>
        {items.map((item) => <div key={item.id}>{item.content}</div>)}
      </div>
    );
  }

  return { ...actual, SortableList: TestSortableList };
});

const addExercisesMock = vi.mocked(addWorkoutSessionExercises);
const getExerciseOptionsMock = vi.mocked(getWorkoutExerciseOptions);
const initializeMock = vi.mocked(initializeWorkoutSession);
const startMock = vi.mocked(startWorkoutSession);
const saveSetMock = vi.mocked(saveWorkoutSessionSet);
const reorderMock = vi.mocked(reorderWorkoutSessionExercises);
const completeMock = vi.mocked(completeWorkoutSession);

const draft: DraftWorkoutSession = {
  sessionId: 501,
  status: 'draft',
  program: { id: 20, name: 'Силовой блок' },
  phase: { id: 30, name: 'Фаза 1' },
  suggestedDay: { id: 40, name: 'День B', position: 1, resolution: 'next_incomplete' },
  availableDays: [
    { id: 39, name: 'День A', position: 0, completed: true },
    { id: 40, name: 'День B', position: 1, completed: false },
  ],
};

const programSession: ActiveWorkoutSession = {
  sessionId: 501,
  status: 'active',
  workoutDate: '2026-09-15',
  program: { id: 20, name: 'Силовой блок' },
  phase: { id: 30, name: 'Фаза 1' },
  day: { id: 40, name: 'День B', position: 1 },
  exercises: [],
};

const ownSession: ActiveWorkoutSession = {
  sessionId: 501,
  status: 'active',
  workoutDate: '2026-09-15',
  program: null,
  phase: null,
  day: null,
  exercises: [],
};

function exerciseData(id: number, position: number, name: string): SessionExerciseData {
  return {
    sessionExerciseId: id,
    workoutSessionId: 501,
    sourceProgramExerciseId: null,
    position,
    status: 'active',
    notes: null,
    exercise: {
      id,
      scope: 'global',
      name,
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
    sets: [],
  };
}

const orderedProgramSession: ActiveWorkoutSession = {
  ...programSession,
  exercises: [
    exerciseData(1, 0, 'Упражнение 1'),
    exerciseData(2, 1, 'Упражнение 2'),
    exerciseData(3, 2, 'Упражнение 3'),
  ],
};

function renderScreen(overrides: Partial<React.ComponentProps<typeof WorkoutSessionScreen>> = {}) {
  const props: React.ComponentProps<typeof WorkoutSessionScreen> = {
    initData: 'telegram-init',
    trainingPlanId: 20,
    onClose: vi.fn(),
    onOpenExerciseMenu: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenChat: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkoutSessionScreen {...props} />), props };
}

beforeEach(() => {
  addExercisesMock.mockReset();
  getExerciseOptionsMock.mockReset();
  initializeMock.mockReset();
  startMock.mockReset();
  saveSetMock.mockReset();
  reorderMock.mockReset();
  completeMock.mockReset();
});

afterEach(cleanup);

describe('WorkoutSessionScreen', () => {
  it('creates the draft first and exposes its session id before a workout type is chosen', async () => {
    const onSessionLifecycleChange = vi.fn();
    initializeMock.mockResolvedValue({ session: draft });

    renderScreen({ onSessionLifecycleChange });

    expect(screen.getByText('Подготавливаем тренировку')).toBeTruthy();
    await screen.findByText('День B');
    expect(initializeMock).toHaveBeenCalledWith('telegram-init', 20);
    expect(onSessionLifecycleChange).toHaveBeenCalledWith({ sessionId: 501, status: 'draft' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('starts the suggested program day only after the user chooses the program workout', async () => {
    initializeMock.mockResolvedValue({ session: draft });
    startMock.mockResolvedValue({ session: programSession });

    renderScreen();
    await screen.findByText('День B');
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith('telegram-init', 501, { type: 'program', programDayId: 40 });
    });
    expect(await screen.findByText('Силовой блок · Фаза 1 · День B')).toBeTruthy();
  });

  it('starts an own workout without requesting or rendering program PLAN/PREVIOUS data', async () => {
    initializeMock.mockResolvedValue({ session: draft });
    startMock.mockResolvedValue({ session: ownSession });

    renderScreen();
    await screen.findByText('День B');
    fireEvent.click(screen.getByRole('button', { name: 'Своя тренировка' }));

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith('telegram-init', 501, { type: 'own' });
    });
    expect(await screen.findByText('Своя тренировка')).toBeTruthy();
    expect(screen.getByText('Упражнений пока нет.')).toBeTruthy();
  });

  it('adds selected exercises from the workout FAB only after explicit OK confirmation', async () => {
    const nextSession: ActiveWorkoutSession = {
      ...ownSession,
      exercises: [exerciseData(42, 0, 'Жим лёжа')],
    };
    initializeMock.mockResolvedValue({ session: ownSession });
    getExerciseOptionsMock.mockResolvedValue({ exercises: [nextSession.exercises[0].exercise] });
    addExercisesMock.mockResolvedValue({ session: nextSession });

    renderScreen();
    await screen.findByText('Своя тренировка');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }));

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    expect(await screen.findByText('Жим лёжа')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Жим лёжа/ }));
    expect(addExercisesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранные упражнения' }));

    await waitFor(() => {
      expect(addExercisesMock).toHaveBeenCalledWith('telegram-init', 501, [42]);
    });
    expect((await screen.findByTestId('sortable-order')).textContent).toBe('42');
  });

  it('resumes an already active session without calling start again', async () => {
    initializeMock.mockResolvedValue({ session: programSession });

    renderScreen();

    expect(await screen.findByText('Силовой блок · Фаза 1 · День B')).toBeTruthy();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('rolls back repeated failed reorders to the last server-acknowledged order', async () => {
    initializeMock.mockResolvedValue({ session: orderedProgramSession });
    let rejectFirst: (reason?: unknown) => void = () => undefined;
    let rejectSecond: (reason?: unknown) => void = () => undefined;
    const firstRequest = new Promise<{ session: ActiveWorkoutSession }>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const secondRequest = new Promise<{ session: ActiveWorkoutSession }>((_resolve, reject) => {
      rejectSecond = reject;
    });
    reorderMock.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);

    renderScreen();
    expect((await screen.findByTestId('sortable-order')).textContent).toBe('1,2,3');

    fireEvent.click(screen.getByRole('button', { name: 'Rotate exercises' }));
    await waitFor(() => expect(screen.getByTestId('sortable-order').textContent).toBe('2,3,1'));

    fireEvent.click(screen.getByRole('button', { name: 'Rotate exercises' }));
    await waitFor(() => expect(screen.getByTestId('sortable-order').textContent).toBe('3,1,2'));

    await act(async () => rejectFirst(new Error('first reorder failed')));
    await waitFor(() => expect(reorderMock).toHaveBeenCalledTimes(2));
    await act(async () => rejectSecond(new Error('second reorder failed')));

    await waitFor(() => expect(screen.getByTestId('sortable-order').textContent).toBe('1,2,3'));
  });
});
