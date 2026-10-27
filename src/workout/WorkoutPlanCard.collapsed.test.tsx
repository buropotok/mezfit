// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SortableListProps } from '../ui/SortableList';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { WorkoutPlanCard } from './WorkoutPlanCard';

const mounted = vi.hoisted(() => ({ exercises: 0 }));
vi.mock('./SessionExercise', () => ({ SessionExercise: () => {
  mounted.exercises += 1;
  return <div>Упражнение дня</div>;
} }));
vi.mock('../ui', async importOriginal => ({
  ...await importOriginal<typeof import('../ui')>(),
  SortableList: ({ items, header, footer }: SortableListProps) => <div>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
afterEach(() => { cleanup(); mounted.exercises = 0; });
const day: CloudProgramDayOutline = {
  day: { id: 'day', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase', position: 0,
    status: 'active', name: 'День А', comment: 'Комментарий дня', category: null },
  exercises: [{ exercise: { id: 'exercise', realmId: 'tg:101', owner: 'tg:101', programDayId: 'day',
    position: 0, status: 'active', notes: null, exercise: { exerciseDefinitionId: '0001', scope: 'public',
      name: 'Жим', nameEn: null, mediaUrl: null } }, sets: [] }],
};
const props = { mode: 'planning' as const, day, creatorName: 'Автор', programName: 'Программа', readOnly: true,
  onEdit: vi.fn(), onComment: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };

describe('optional controlled day collapse', () => {
  it('lazily mounts exercises and footer and keeps the same header in both states', () => {
    const toggle = vi.fn();
    const { rerender } = render(<WorkoutPlanCard {...props} collapsed onCollapsedChange={toggle}
      scheduledTiming={{ date: '27.10.2026', time: '08:00 – 09:00' }} />);
    expect(mounted.exercises).toBe(0);
    expect(screen.queryByText('Комментарий дня')).toBeNull();
    expect(screen.getByText('27.10.2026')).toBeTruthy();
    expect(screen.getByText('08:00 – 09:00')).toBeTruthy();
    const chevron = screen.getByRole('button', { name: 'Развернуть тренировку' });
    expect(chevron.nextElementSibling?.getAttribute('aria-label')).toBe('Автор: Автор');
    expect(chevron.firstElementChild?.classList.contains('workout-plan-card__chevron--expanded')).toBe(false);
    fireEvent.click(chevron);
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<WorkoutPlanCard {...props} collapsed={false} onCollapsedChange={toggle}
      scheduledTiming={{ date: '27.10.2026', time: '08:00 – 09:00' }} />);
    expect(screen.getAllByText('День А')).toHaveLength(1);
    expect(screen.getByText('Упражнение дня')).toBeTruthy();
    expect(screen.getByText('Комментарий дня')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Свернуть тренировку' }).firstElementChild?.classList
      .contains('workout-plan-card__chevron--expanded')).toBe(true);
  });
  it('preserves expanded rendering when all new props are omitted', () => {
    render(<WorkoutPlanCard {...props} />);
    expect(screen.getByText('Упражнение дня')).toBeTruthy();
    expect(screen.getByText('Комментарий дня')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /тренировку/ })).toBeNull();
  });
});
