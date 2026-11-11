// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import type { WorkoutSessionExerciseProps } from './sessionExerciseTypes';
import type { SortableListProps } from '../ui/SortableList';
import { WorkoutSessionCard } from './WorkoutSessionCard';

vi.mock('../discussions/useEntityDiscussions', () => ({
  useEntityDiscussions: () => ({ content: null, openTarget: vi.fn(), menuItem: null }),
}));
vi.mock('./SessionExercise', () => ({ SessionExercise: ({ data, collapsed, focusSetId }: WorkoutSessionExerciseProps<string>) =>
  <div data-testid={String(data.sessionExerciseId)} data-collapsed={collapsed} data-focus-set={focusSetId}>Упражнение</div> }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  SortableList: ({ items, header, footer }: SortableListProps) => <div>{header}
    {items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function exercise(id: string, position: number): ActiveWorkoutSession<string>['exercises'][number] {
  return {
    sessionExerciseId: id, workoutSessionId: 'execution', sourceProgramExerciseId: null,
    position, status: 'active', notes: null, sets: [], exercise: {
      id, name: id, scope: 'global', description: null, tracking_type: 'weight_reps',
      category_code: 'chest', equipment_code: 'barbell', reference_source: null,
      reference_key: null, reference_media_url: null, is_favourite: false, can_edit: false,
    },
  };
}
const session: ActiveWorkoutSession<string> = {
  sessionId: 'execution', occurrenceId: null, status: 'active',
  workoutDate: '2026-11-11', startedAt: '2026-11-11T10:00:00Z',
  completedAt: null, program: null, phase: null, day: null,
  exercises: [exercise('ex-1', 0), exercise('ex-2', 1)],
};
const handlers = { onReorderExerciseIds: vi.fn(), onSaveSet: vi.fn(async () => undefined) };

it('opens the complete FACT workout collapsed for the root discussion', () => {
  render(<WorkoutSessionCard session={session} {...handlers} />);
  expect(screen.getByTestId('ex-1').getAttribute('data-collapsed')).toBe('true');
  expect(screen.getByTestId('ex-2').getAttribute('data-collapsed')).toBe('true');
});

it('opens the complete FACT workout with only the target exercise expanded', () => {
  render(<WorkoutSessionCard session={session} {...handlers}
    focusExerciseId="ex-2" focusSetId="set-2" />);
  expect(screen.getByTestId('ex-1').getAttribute('data-collapsed')).toBe('true');
  expect(screen.getByTestId('ex-2').getAttribute('data-collapsed')).toBe('false');
  expect(screen.getByTestId('ex-2').getAttribute('data-focus-set')).toBe('set-2');
});
