// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeWorkoutSession,
  initializeWorkoutSession,
  reorderWorkoutSessionExercises,
  saveWorkoutSessionSet,
  startWorkoutSession,
} from '../api';
import { WorkoutSessionScreen } from './WorkoutSessionScreen';
import type { ActiveWorkoutSession, DraftWorkoutSession } from './workoutSessionTypes';

vi.mock('../api', () => ({
  completeWorkoutSession: vi.fn(),
  initializeWorkoutSession: vi.fn(),
  reorderWorkoutSessionExercises: vi.fn(),
  saveWorkoutSessionSet: vi.fn(),
  startWorkoutSession: vi.fn(),
}));

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

  it('resumes an already active session without calling start again', async () => {
    initializeMock.mockResolvedValue({ session: programSession });

    renderScreen();

    expect(await screen.findByText('Силовой блок · Фаза 1 · День B')).toBeTruthy();
    expect(startMock).not.toHaveBeenCalled();
  });
});
