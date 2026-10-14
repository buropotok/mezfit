// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';

vi.mock('../exercises/PublicExercises', () => ({
  PublicExercises: ({ mode, selectedExerciseIds, onToggleExercise, selectionDisabled }: {
    mode: 'browse' | 'select';
    selectedExerciseIds: ReadonlySet<string>;
    onToggleExercise: (id: string) => void;
    selectionDisabled?: boolean;
  }) => (
    <div aria-label="Общий каталог Dexie Cloud" data-mode={mode}>
      {['0001', '0002'].map((id) => (
        <button key={id} type="button" disabled={selectionDisabled}
          aria-pressed={selectedExerciseIds.has(id)} onClick={() => onToggleExercise(id)}>{id}</button>
      ))}
    </div>
  ),
}));

afterEach(cleanup);

describe('WorkoutExerciseSelectionSheet on canonical Dexie catalogue', () => {
  it('uses MezfitBottomSheet and selects immutable string IDs, not D1 numeric IDs', () => {
    const onConfirm = vi.fn();
    render(
      <WorkoutExerciseSelectionSheet initData="telegram-test" saving={false}
        onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog', { name: 'Выбор упражнений для тренировки' })).toBeTruthy();
    expect(screen.getByLabelText('Общий каталог Dexie Cloud').getAttribute('data-mode')).toBe('select');
    fireEvent.click(screen.getByRole('button', { name: '0001' }));
    fireEvent.click(screen.getByRole('button', { name: '0002' }));
    expect(screen.getByRole('button', { name: '0001' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнения (2)' }));
    expect(onConfirm).toHaveBeenCalledWith(['0001', '0002']);
  });

  it('shows the error without resetting selection and prevents duplicate submission', () => {
    const onConfirm = vi.fn();
    const view = (saving: boolean, actionError = '') => (
      <WorkoutExerciseSelectionSheet initData="telegram-test" saving={saving}
        actionError={actionError} onConfirm={onConfirm} onClose={vi.fn()} />
    );
    const { rerender } = render(view(false));
    fireEvent.click(screen.getByRole('button', { name: '0001' }));
    rerender(view(true, 'Ошибка сохранения'));
    expect(screen.getByRole('alert').textContent).toContain('Ошибка сохранения');
    expect(screen.getByRole('button', { name: '0001' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Добавляем…' }).hasAttribute('disabled')).toBe(true);
  });

  it('closes only when not saving', () => {
    const onClose = vi.fn();
    const view = (saving: boolean) => (
      <WorkoutExerciseSelectionSheet initData="telegram-test" saving={saving}
        onConfirm={vi.fn()} onClose={onClose} />
    );
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).not.toHaveBeenCalled();
    rerender(view(false));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
