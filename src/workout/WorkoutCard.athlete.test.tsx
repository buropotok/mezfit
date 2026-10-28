// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutPlanCardHeader } from './WorkoutPlanCard';
import { WorkoutSessionCard } from './WorkoutSessionCard';
import type { SortableListProps } from '../ui/SortableList';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

vi.mock('../ui', async original => ({ ...await original<typeof import('../ui')>(),
  SortableList: ({ header, footer }: SortableListProps) => <div>{header}{footer}</div>,
}));
afterEach(cleanup);
it('shows the athlete in both collapsed and expanded PLAN headers, with the menu before the chevron', () => {
  const toggle = vi.fn();
  const props = { name: 'День', creatorName: 'Тренер', athleteName: 'Анна',
    creatorAvatar: <span>Фото тренера</span>, athleteAvatar: <span>Фото Анны</span>, onCollapsedChange: toggle };
  const view = render(<WorkoutPlanCardHeader {...props} collapsed><button>Меню дня</button></WorkoutPlanCardHeader>);
  expect(screen.getByLabelText('Атлет: Анна').textContent).toBe('Фото Анны');
  expect(screen.queryByText('Меню дня')).toBeNull();
  view.rerender(<WorkoutPlanCardHeader {...props} collapsed={false}><button>Меню дня</button></WorkoutPlanCardHeader>);
  const chevron = screen.getByRole('button', { name: 'Свернуть тренировку' });
  expect(chevron.previousElementSibling).toBe(screen.getByRole('button', { name: 'Меню дня' }));
  fireEvent.click(chevron);
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.queryByText('Фото тренера')).toBeNull();
});
it.each(['active', 'completed'] as const)('shows athlete identity and %s status, and can hide status on the training screen', status => {
  const session: ActiveWorkoutSession<string> = { sessionId: 'session', occurrenceId: null, status,
    workoutDate: '2026-10-28', startedAt: '2026-10-28T10:05:00.000Z', completedAt: status === 'completed' ? '2026-10-28T10:45:00.000Z' : null,
    program: null, phase: null, day: null, exercises: [],
    creator: { id: 'tg:101', firstName: 'Тренер', lastName: null, username: null, photoUrl: null } };
  const view = render(<WorkoutSessionCard session={session} athleteName="Анна" athleteAvatar={<span>Фото Анны</span>}
    onReorderExerciseIds={() => {}} onSaveSet={async () => {}} />);
  expect(screen.getByLabelText('Атлет: Анна').textContent).toBe('Фото Анны');
  const label = status === 'active' ? 'Запущена' : 'Завершена';
  expect(screen.getByText(label)).toBeTruthy();
  if (status === 'active') expect(screen.getByText(label).classList.contains('ui-badge--green')).toBe(true);
  view.rerender(<WorkoutSessionCard showStatus={false} session={session} athleteName="Анна"
    onReorderExerciseIds={() => {}} onSaveSet={async () => {}} />);
  expect(screen.queryByText(label)).toBeNull();
});
