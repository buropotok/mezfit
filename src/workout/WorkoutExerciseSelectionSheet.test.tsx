// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';

vi.mock('../exercises', () => ({
  MezfitExercisesSheet: ({
    selectedExerciseIds,
    onToggleExercise,
    footer,
    notice,
    onClose,
  }: {
    selectedExerciseIds: ReadonlySet<number>;
    onToggleExercise: (id: number) => void;
    footer?: React.ReactNode;
    notice?: React.ReactNode;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Упражнения">
      {notice}
      <button
        type="button"
        aria-pressed={selectedExerciseIds.has(11)}
        onClick={() => onToggleExercise(11)}
      >
        Жим лёжа
      </button>
      <button
        type="button"
        aria-pressed={selectedExerciseIds.has(22)}
        onClick={() => onToggleExercise(22)}
      >
        Тяга верхнего блока
      </button>
      {footer}
      <button type="button" onClick={onClose}>Закрыть</button>
    </div>
  ),
}));

afterEach(cleanup);

describe('WorkoutExerciseSelectionSheet', () => {
  it('keeps selection while using the shared Mezfit exercise sheet', () => {
    const onConfirm = vi.fn();

    render(
      <WorkoutExerciseSelectionSheet
        initData="init-data"
        saving={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Жим лёжа' }));
    fireEvent.click(screen.getByRole('button', { name: 'Тяга верхнего блока' }));

    expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Тяга верхнего блока' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранные · 2' }));
    expect(onConfirm).toHaveBeenCalledWith([11, 22]);
  });

  it('keeps the sheet open with its current selection when confirmation reports an error', () => {
    const { rerender } = render(
      <WorkoutExerciseSelectionSheet
        initData="init-data"
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Жим лёжа' }));

    rerender(
      <WorkoutExerciseSelectionSheet
        initData="init-data"
        saving={false}
        actionError="Не удалось добавить упражнения"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Не удалось добавить упражнения');
    expect(screen.getByRole('dialog', { name: 'Упражнения' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true');
  });
});
