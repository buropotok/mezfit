// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import { ProgramClientPicker } from '../program/ProgramClientPicker';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';

vi.mock('../exercises/PublicExercises', () => ({
  PublicExercises: ({ selectedExerciseIds, onToggleExercise, onNavigationContextChange }: {
    selectedExerciseIds: ReadonlySet<string>;
    onToggleExercise: (id: string) => void;
    onNavigationContextChange: (context: NavigationContext | null) => void;
  }) => (
    <div data-testid="selection-catalogue">
      <button onClick={() => onToggleExercise('0001')}
        aria-pressed={selectedExerciseIds.has('0001')}>Выбрать упражнение</button>
      <button onClick={() => onNavigationContextChange({
        title: 'Карточка упражнения', scrollKey: 'exercise:0001', onBack: () => onNavigationContextChange(null),
      })}>Открыть карточку</button>
    </div>
  ),
}));

afterEach(cleanup);

describe('selection sheet lifecycle', () => {
  it('keeps the client sheet shell through opening and closing, then resets the search', () => {
    const view = (opened: boolean) => (
      <ProgramClientPicker opened={opened} clients={[]} loading={false}
        onClose={vi.fn()} onSelect={vi.fn()} />
    );
    const { container, rerender } = render(view(false));
    const shell = container.querySelector('[aria-label="Выбрать клиента"]');
    if (!(shell instanceof HTMLElement)) throw new Error('Missing client sheet shell');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByPlaceholderText('Поиск клиента')).toBeNull();

    rerender(view(true));
    expect(screen.getByRole('dialog', { name: 'Выбрать клиента' })).toBe(shell);
    fireEvent.change(screen.getByPlaceholderText('Поиск клиента'), { target: { value: 'Анна' } });

    rerender(view(false));
    expect(shell.getAttribute('aria-hidden')).toBe('true');
    expect(shell.hasAttribute('inert')).toBe(true);
    expect(screen.getByPlaceholderText('Поиск клиента').getAttribute('value')).toBe('Анна');
    fireEvent.transitionEnd(screen.getByPlaceholderText('Поиск клиента'));
    expect(screen.queryByPlaceholderText('Поиск клиента')).not.toBeNull();
    fireEvent.transitionEnd(shell);
    expect(screen.queryByPlaceholderText('Поиск клиента')).toBeNull();

    rerender(view(true));
    expect(screen.getByRole('dialog', { name: 'Выбрать клиента' })).toBe(shell);
    expect(screen.getByPlaceholderText('Поиск клиента').getAttribute('value')).toBe('');
  });

  it('loads the catalogue on demand and releases navigation before the closing animation ends', () => {
    const onNavigationContextChange = vi.fn();
    const view = (opened: boolean) => (
      <WorkoutExerciseSelectionSheet opened={opened} initData="test" saving={false}
        onNavigationContextChange={onNavigationContextChange} onConfirm={vi.fn()} onClose={vi.fn()} />
    );
    const { container, rerender } = render(view(false));
    const shell = container.querySelector('[aria-label="Выбор упражнений для тренировки"]');
    if (!(shell instanceof HTMLElement)) throw new Error('Missing exercise sheet shell');
    expect(screen.queryByTestId('selection-catalogue')).toBeNull();
    expect(onNavigationContextChange).not.toHaveBeenCalled();

    rerender(view(true));
    expect(screen.getByRole('dialog', { name: 'Выбор упражнений для тренировки' })).toBe(shell);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать упражнение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть карточку' }));
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Карточка упражнения' }));

    rerender(view(false));
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('selection-catalogue')).not.toBeNull();
    fireEvent.transitionEnd(screen.getByTestId('selection-catalogue'));
    expect(screen.queryByTestId('selection-catalogue')).not.toBeNull();

    // Reopening before the closing transition finishes must not dispose the active catalogue.
    rerender(view(true));
    fireEvent.transitionEnd(shell);
    expect(screen.getByRole('button', { name: 'Выбрать упражнение' }).getAttribute('aria-pressed')).toBe('true');
    rerender(view(false));
    fireEvent.transitionEnd(shell);
    expect(screen.queryByTestId('selection-catalogue')).toBeNull();
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(null);

    rerender(view(true));
    expect(screen.getByRole('dialog', { name: 'Выбор упражнений для тренировки' })).toBe(shell);
    expect(screen.getByRole('button', { name: 'Добавить упражнения (0)' }).hasAttribute('disabled')).toBe(true);
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Упражнения' }));
  });
});
