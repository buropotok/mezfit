// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutPlanCardHeader } from './WorkoutPlanCard';
import { Badge } from '../ui';
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
  // The legacy direct siblings were replaced by explicit compact action slots.
  const slots = chevron.closest('.ui-compact-action-group')?.querySelectorAll('.ui-compact-action-group__slot');
  expect(slots).toHaveLength(2);
  expect(slots?.[0].querySelector('button')).toBe(screen.getByRole('button', { name: 'Меню дня' }));
  expect(slots?.[1].querySelector('button')).toBe(chevron);
  fireEvent.click(chevron);
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.queryByText('Фото тренера')).toBeNull();
});
it('places a scheduled PLAN status beneath the header columns without constraining its capsule to the name column', () => {
  const { container } = render(<WorkoutPlanCardHeader name="День 2" programName="Моя программа"
    creatorName="Тренер" athleteName="Анна" status={<Badge color="gray" textVariant="caption">Пропущена</Badge>}
    scheduledTiming={{ date: '19.11.2026', time: '08:00 — 09:00' }} />);
  const header = container.querySelector('.workout-session-card__header');
  const statusRow = header?.querySelector('.workout-session-card__status-row');
  expect(statusRow?.parentElement).toBe(header);
  expect(statusRow?.previousElementSibling?.getAttribute('aria-label')).toBe('Атлет: Анна');
  expect(statusRow?.querySelector('.ui-badge')?.textContent).toBe('Пропущена');
  expect(header?.querySelector('.workout-session-card__copy .ui-badge')).toBeNull();
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
  expect(screen.getByText(label).parentElement?.classList.contains('workout-session-card__status-row')).toBe(true);
  if (status === 'active') expect(screen.getByText(label).classList.contains('ui-badge--green')).toBe(true);
  view.rerender(<WorkoutSessionCard showStatus={false} session={session} athleteName="Анна"
    onReorderExerciseIds={() => {}} onSaveSet={async () => {}} />);
  expect(screen.queryByText(label)).toBeNull();
});
