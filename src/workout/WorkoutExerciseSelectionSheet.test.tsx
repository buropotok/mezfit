// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicExercisesProps } from '../exercises/PublicExercises';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';

vi.mock('../NavigationShell', () => ({
  useNavigationBackTransition: () => (callback: () => void) => callback(),
}));

/** Isolate the sheet contract without duplicating the real catalogue's Dexie/filter tests. */
vi.mock('../exercises/PublicExercises', () => ({
  PublicExercises: ({
    mode, selectedExerciseIds, selectionDisabled, onToggleExercise, onNavigationContextChange,
  }: PublicExercisesProps) => {
    const [category, setCategory] = useState<'chest' | 'back' | null>(null);
    useEffect(() => {
      if (category === null) {
        onNavigationContextChange?.(null);
        return;
      }
      onNavigationContextChange?.({
        title: category === 'chest' ? 'Грудь' : 'Спина',
        scrollKey: category,
        onBack: () => setCategory(null),
      });
    }, [category, onNavigationContextChange]);
    const exercise = category === 'chest'
      ? { id: '0001', name: 'Жим лёжа' }
      : { id: '0022', name: 'Тяга верхнего блока' };
    return <div data-testid="public-catalogue" data-mode={mode}>
      {category === null ? <>
        <button type="button" onClick={() => setCategory('chest')}>Грудь</button>
        <button type="button" onClick={() => setCategory('back')}>Спина</button>
      </> : <button type="button"
        aria-pressed={selectedExerciseIds?.has(exercise.id) ?? false}
        disabled={selectionDisabled}
        onClick={() => onToggleExercise?.(exercise.id)}
      >{exercise.name}</button>}
    </div>;
  },
}));

afterEach(cleanup);

describe('WorkoutExerciseSelectionSheet', () => {
  it('reuses the new public catalogue and sends multiple canonical string IDs after OK', async () => {
    const onConfirm = vi.fn();
    const onNavigationContextChange = vi.fn();
    render(<WorkoutExerciseSelectionSheet saving={false} onConfirm={onConfirm}
      onClose={vi.fn()} onNavigationContextChange={onNavigationContextChange} />);

    expect(screen.getByTestId('public-catalogue').getAttribute('data-mode')).toBe('select');
    expect(screen.queryByRole('button', { name: 'Добавить выбранные упражнения' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Грудь' }),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Жим лёжа' }));
    expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Спина' }));
    fireEvent.click(screen.getByRole('button', { name: 'Тяга верхнего блока' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true');

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранные упражнения' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(['0001', '0022']);
  });

  it('preserves selection and stays open after confirmation yields an error', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<WorkoutExerciseSelectionSheet saving={false}
      onConfirm={onConfirm} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    fireEvent.click(screen.getByRole('button', { name: 'Жим лёжа' }));
    rerender(<WorkoutExerciseSelectionSheet saving={false} actionError="Сохранение пока недоступно"
      onConfirm={onConfirm} onClose={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toContain('Сохранение пока недоступно');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('prevents modifying and confirming selection when saving', () => {
    const onConfirm = vi.fn();
    render(<WorkoutExerciseSelectionSheet saving={true} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    const entry = screen.getByRole('button', { name: 'Жим лёжа' });
    expect((entry as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Добавить выбранные упражнения' })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
