// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoachExercises, getWorkoutExerciseOptions, type ExerciseDefinition } from '../api';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    getCoachExercises: vi.fn(),
    getWorkoutExerciseOptions: vi.fn(),
  };
});

const chestExercise: ExerciseDefinition = {
  id: 11,
  scope: 'global',
  name: 'Жим лёжа',
  description: null,
  tracking_type: 'weight_reps',
  category_code: 'chest',
  equipment_code: 'barbell',
  reference_source: null,
  reference_key: null,
  reference_media_url: null,
  is_favourite: false,
  can_edit: false,
};

const backExercise: ExerciseDefinition = {
  ...chestExercise,
  id: 22,
  name: 'Тяга верхнего блока',
  category_code: 'back',
  equipment_code: 'cable',
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getCoachExercises).mockReset();
  vi.mocked(getWorkoutExerciseOptions).mockReset();
  vi.mocked(getWorkoutExerciseOptions).mockImplementation(async (_initData, categoryCode) => ({
    exercises: categoryCode === 'chest' ? [chestExercise] : categoryCode === 'back' ? [backExercise] : [],
  }));
});

describe('WorkoutExerciseSelectionSheet', () => {
  it('reuses the exercise catalog in select mode and keeps selection across categories', async () => {
    const onConfirm = vi.fn();
    const onNavigationContextChange = vi.fn();

    render(
      <WorkoutExerciseSelectionSheet
        initData="init-data"
        saving={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        onNavigationContextChange={onNavigationContextChange}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Упражнения' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Поиск' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Только избранные' })).toBeNull();
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Упражнения' })));

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    await waitFor(() => expect(getWorkoutExerciseOptions).toHaveBeenCalledWith('init-data', 'chest'));
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Грудь' })));
    expect(getCoachExercises).not.toHaveBeenCalled();

    const chestRow = await screen.findByRole('button', { name: 'Жим лёжа' });
    expect(chestRow.getAttribute('aria-pressed')).toBe('false');
    const menuTrigger = screen.getByRole('button', { name: 'Действия: Жим лёжа' });
    expect(chestRow.contains(menuTrigger)).toBe(false);

    fireEvent.click(chestRow);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Добавить выбранные упражнения' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Упражнения' })));
    fireEvent.click(screen.getByRole('button', { name: 'Спина' }));
    const backRow = await screen.findByRole('button', { name: 'Тяга верхнего блока' });
    fireEvent.click(backRow);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Тяга верхнего блока' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранные упражнения' }));
    expect(onConfirm).toHaveBeenCalledWith([11, 22]);
  });

  it('keeps the sheet open with its current selection when confirmation reports an error', async () => {
    const { rerender } = render(
      <WorkoutExerciseSelectionSheet
        initData="init-data"
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Жим лёжа' }));

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
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Жим лёжа' }).getAttribute('aria-pressed')).toBe('true');
  });
});
