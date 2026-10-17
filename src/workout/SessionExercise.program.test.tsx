// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { SessionExercise } from './SessionExercise';
import { WorkoutSessionCard } from './WorkoutSessionCard';

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  return { ...actual,
    SortableList: ({ items, header, footer }: React.ComponentProps<typeof actual.SortableList>) =>
      <div>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
  };
});
afterEach(() => cleanup());

const item: CloudProgramDayOutline['exercises'][number] = {
  exercise: { id: 'program-exercise', realmId: 'tg:101', owner: 'tg:101', programDayId: 'day',
    position: 0, status: 'active', notes: 'Контроль техники', exercise: {
      exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null, mediaUrl: '/exercise-image',
      get trackingType(): never { throw new Error('Program rendering must not read tracking type'); },
    } },
  sets: [{ id: 'program-set', realmId: 'tg:101', owner: 'tg:101', programExerciseId: 'program-exercise',
    position: 0, status: 'active', setLabel: 'warmup', comment: 'Плавно', materialLinks: [], chatLinks: [],
    plannedWeightKg: 123, plannedReps: 15, plannedDurationSeconds: 60, plannedDistanceMeters: 100 }],
};

describe('existing exercise component in program mode', () => {
  it('keeps media, disclosure, numbered set rows and the glass add-set control without FACT or an editor', () => {
    const addSet = vi.fn();
    const { container } = render(<SessionExercise mode="program" data={item} onAddSet={addSet} />);
    expect(container.querySelector('.session-exercise')).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/exercise-image');
    expect(screen.getByText('1 подход')).toBeTruthy();
    expect(screen.getByText('Подход 1')).toBeTruthy();
    expect(screen.getByText('Разминочный')).toBeTruthy();
    expect(screen.getByText('Плавно')).toBeTruthy();
    expect(screen.queryByText(/123|ввести факт|ввести план|План:|Пред.:|выполнено|RPE/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
    fireEvent.click(screen.getByText('Подход 1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const add = screen.getByRole('button', { name: 'Добавить подход' });
    expect(add.querySelector('.session-exercise__add-set-button')).not.toBeNull();
    fireEvent.click(add);
    expect(addSet).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть упражнение' }));
    expect(screen.queryByRole('button', { name: 'Добавить подход' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть упражнение' }));
    expect(screen.getByRole('button', { name: 'Добавить подход' })).toBeTruthy();
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.exercise-media-fallback')).not.toBeNull();
  });

  it('disables creation during a mutation and omits authoring for read-only programs', () => {
    const addSet = vi.fn();
    const view = render(<SessionExercise mode="program" data={item} busy onAddSet={addSet} />);
    const add = screen.getByRole('button', { name: 'Добавить подход' });
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(add);
    expect(addSet).not.toHaveBeenCalled();
    view.rerender(<SessionExercise mode="program" data={item} editable={false} onAddSet={addSet} />);
    expect(screen.queryByRole('button', { name: 'Добавить подход' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Свернуть упражнение' })).toBeTruthy();
  });

  it('uses the shared component inside a program day and emits its stable exercise ID', () => {
    const addSet = vi.fn();
    render(<WorkoutSessionCard mode="planning" day={{
      day: { id: 'day', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase', name: 'А',
        category: null, comment: null, position: 0, status: 'active' }, exercises: [item],
    }} creatorName="Тренер" onAddSet={addSet} onEdit={() => {}} onComment={() => {}}
      onMove={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    expect(addSet).toHaveBeenCalledWith('program-exercise');
  });
});
