// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SortableListProps } from '../ui/SortableList';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { WorkoutPlanCard } from './WorkoutPlanCard';
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return { ...actual, SortableList: ({ items, disabled, onReorder, header }: SortableListProps) =>
    <div>{header}<button disabled={disabled} onClick={() => onReorder([...items].reverse())}>Переставить</button></div> };
});
afterEach(cleanup);
const day: CloudProgramDayOutline = { day: { id: 'day', realmId: 'tg:1', owner: 'tg:1',
  programPhaseId: 'phase', name: 'День А', category: 'Старая категория', comment: null,
  position: 0, status: 'active' }, exercises: ['one', 'two'].map((id, position) => ({
    exercise: { id, realmId: 'tg:1', owner: 'tg:1', programDayId: 'day', position,
      status: 'active', notes: null, exercise: { exerciseDefinitionId: id, scope: 'public',
        name: id, nameEn: null, mediaUrl: null } }, sets: [],
  })) };
const defaults = { mode: 'planning' as const, day, creatorName: 'Автор', programName: 'Моя программа',
  onEdit: () => {}, onComment: () => {}, onMove: () => {}, onDuplicate: () => {}, onDelete: () => {} };
describe('existing day sortable list integration', () => {
  it('passes new stable exercise IDs to persistence and uses the program subtitle', () => {
    const reorder = vi.fn();
    render(<WorkoutPlanCard {...defaults} onReorderExercises={reorder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Переставить' }));
    expect(reorder).toHaveBeenCalledWith(['two', 'one']);
    expect(screen.getByText('Моя программа')).toBeTruthy();
    expect(screen.queryByText('Старая категория')).toBeNull();
  });
  it.each([{ readOnly: true }, { busy: true }])('disables reordering when unavailable: %o', props => {
    render(<WorkoutPlanCard {...defaults} {...props} onReorderExercises={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Переставить' }).hasAttribute('disabled')).toBe(true);
  });
});
