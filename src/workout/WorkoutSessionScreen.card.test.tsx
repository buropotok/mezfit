// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeWorkoutSession } from '../api';
import { WorkoutSessionScreen } from './WorkoutSessionScreen';
import type { SessionExerciseData, SessionExerciseSetData } from './sessionExerciseTypes';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

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

  function TestSortableList({ items, header, footer }: SortableListProps) {
    return (
      <div data-testid="workout-sortable-card">
        <div data-testid="workout-sortable-header">{header}</div>
        <div data-testid="workout-sortable-items">{items.map((item) => <div key={item.id}>{String(item.id)}</div>)}</div>
        <div data-testid="workout-sortable-footer">{footer}</div>
      </div>
    );
  }

  return { ...actual, SortableList: TestSortableList };
});

const initializeMock = vi.mocked(initializeWorkoutSession);

function setData(id: number, position: number, status: SessionExerciseSetData['status']): SessionExerciseSetData {
  return {
    sessionSetId: id,
    sourceProgramSetId: null,
    position,
    status,
    plan: null,
    previous: null,
    fact: null,
  };
}

function exerciseData(
  id: number,
  position: number,
  name: string,
  sets: SessionExerciseSetData[],
): SessionExerciseData {
  return {
    sessionExerciseId: id,
    workoutSessionId: 501,
    sourceProgramExerciseId: id,
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
    sets,
  };
}

const session: ActiveWorkoutSession = {
  sessionId: 501,
  occurrenceId: null,
  status: 'active',
  workoutDate: '2026-10-07',
  startedAt: '2026-10-07T18:00:00Z',
  completedAt: null,
  program: { id: 20, name: 'Силовой блок' },
  phase: { id: 30, name: 'Фаза 1' },
  day: { id: 40, name: 'День B', position: 1 },
  creator: {
    id: 9,
    firstName: 'Анна',
    lastName: 'Тренер',
    username: 'anna',
    photoUrl: 'https://example.com/coach.jpg',
  },
  exercises: [
    exerciseData(1, 0, 'Упражнение 1', [
      setData(11, 0, 'completed'),
      setData(12, 1, 'pending'),
    ]),
    exerciseData(2, 1, 'Упражнение 2', [
      setData(21, 0, 'completed'),
      setData(22, 1, 'completed'),
    ]),
  ],
};

beforeEach(() => {
  initializeMock.mockReset();
  initializeMock.mockResolvedValue({ session });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkoutSessionScreen workout card', () => {
  it('renders workout identity in the header and averages exercise progress in the footer', async () => {
    const { container } = render(
      <WorkoutSessionScreen initData="telegram-init" onClose={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('workout-sortable-card')).not.toBeNull());

    const header = screen.getByTestId('workout-sortable-header');
    expect(header.textContent).toContain('День B');
    expect(header.textContent).toContain('Силовой блок');

    const avatar = header.querySelector('.workout-session-card__avatar');
    expect(avatar?.getAttribute('src')).toBe('https://example.com/coach.jpg');
    expect(header.querySelector('.workout-session-card__icon-artwork')).not.toBeNull();

    const progress = screen.getByRole('progressbar', { name: 'Прогресс тренировки' });
    expect(progress.getAttribute('aria-valuenow')).toBe('75');
    expect(
      container.querySelector<HTMLElement>('.workout-session-card__progress-value')?.style.width,
    ).toBe('75%');

    expect(screen.getByTestId('workout-sortable-items').children).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Меню тренировки' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Комментарий' })).toBeNull();
    expect(screen.getByText(/^\d{2}:\d{2} — …$/)).toBeTruthy();
  });
});
