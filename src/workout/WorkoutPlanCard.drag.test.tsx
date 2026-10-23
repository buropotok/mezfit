// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SortableListProps } from '../ui/SortableList';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { WorkoutPlanCard } from './WorkoutPlanCard';

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    SortableList: ({ items, header, onDragStart, onReorder, disabled, lockToVerticalAxis, syncDropLayout }: SortableListProps) =>
      <div data-testid="program-sortable-list" data-vertical={String(lockToVerticalAxis)}
        data-sync-drop={String(syncDropLayout)}>
        {header}
        {items.map((item) => <div key={item.id}>{item.content}</div>)}
        <button disabled={disabled} onClick={() => onDragStart?.(items[0].id)}>Поднять карточку</button>
        <button disabled={disabled} onClick={() => onReorder([...items].reverse())}>Отпустить карточку</button>
      </div>,
  };
});

afterEach(cleanup);

const day: CloudProgramDayOutline = {
  day: { id: 'day', realmId: 'tg:1', owner: 'tg:1', programPhaseId: 'phase',
    name: 'День А', category: null, comment: null, position: 0, status: 'active' },
  exercises: ['first', 'second'].map((id, position) => ({
    exercise: { id, realmId: 'tg:1', owner: 'tg:1', programDayId: 'day', position,
      status: 'active', notes: null,
      exercise: { exerciseDefinitionId: id, scope: 'public',
        name: id, nameEn: null, mediaUrl: null } },
    sets: [],
  })),
};

const defaults = {
  mode: 'planning' as const,
  day,
  creatorName: 'Автор',
  onEdit: () => {}, onComment: () => {}, onMove: () => {},
  onDuplicate: () => {}, onDelete: () => {},
  onReorderExercises: () => {},
};

const bodies = () => [...document.querySelectorAll<HTMLElement>('.session-exercise__body')];

describe('program exercise long-press reordering', () => {
  it('collapses every card on lift, keeps them compact after drop, and allows reopening', () => {
    render(<WorkoutPlanCard {...defaults} />);

    expect(bodies()).toHaveLength(2);
    expect(bodies().every((body) => !body.hidden)).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Свернуть упражнение' })[0]);
    expect(bodies().map((body) => body.hidden)).toEqual([true, false]);

    fireEvent.click(screen.getByRole('button', { name: 'Поднять карточку' }));
    expect(bodies().map((body) => body.hidden)).toEqual([true, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Отпустить карточку' }));
    expect(bodies().map((body) => body.hidden)).toEqual([true, true]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[1]);
    expect(bodies().map((body) => body.hidden)).toEqual([true, false]);
  });

  it('uses UIkit drag alignment and synchronous drop settings for program plans', () => {
    render(<WorkoutPlanCard {...defaults} />);
    const sortable = screen.getByTestId('program-sortable-list');
    expect(sortable.getAttribute('data-vertical')).toBe('true');
    expect(sortable.getAttribute('data-sync-drop')).toBe('true');
  });

  it('does not allow a read-only viewer to start reordering', () => {
    render(<WorkoutPlanCard {...defaults} readOnly />);
    expect(screen.getByRole('button', { name: 'Поднять карточку' }).hasAttribute('disabled')).toBe(true);
  });
});
