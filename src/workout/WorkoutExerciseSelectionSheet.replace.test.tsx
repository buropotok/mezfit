// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';

vi.mock('../exercises/PublicExercises', () => ({
  PublicExercises: ({ selectedExerciseIds, onToggleExercise, selectionDisabled }: {
    selectedExerciseIds: ReadonlySet<string>;
    onToggleExercise: (id: string) => void;
    selectionDisabled?: boolean;
  }) => <div>{['0001', '0002', '0003'].map(id =>
    <button key={id} type="button" disabled={selectionDisabled}
      aria-pressed={selectedExerciseIds.has(id)}
      onClick={() => onToggleExercise(id)}>{id}</button>)}</div>,
}));
afterEach(cleanup);

it('selects exactly one replacement and changes the existing sheet action', () => {
  const onConfirm = vi.fn();
  render(<WorkoutExerciseSelectionSheet initData="" mode="replace" saving={false}
    onConfirm={onConfirm} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Заменить' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '0001' }));
  fireEvent.click(screen.getByRole('button', { name: '0002' }));
  expect(screen.getByRole('button', { name: '0001' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: '0002' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Заменить' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledWith(['0002']);
});

it('does not submit a duplicate replacement while saving', () => {
  const onConfirm = vi.fn();
  render(<WorkoutExerciseSelectionSheet initData="" mode="replace" saving
    onConfirm={onConfirm} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Заменяем…' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Заменяем…' }));
  expect(onConfirm).not.toHaveBeenCalled();
});
