// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkoutExerciseOptions, type ExerciseDefinition } from '../api';
import { WorkoutExercisePicker } from './WorkoutExercisePicker';

vi.mock('../api', () => ({
  getWorkoutExerciseOptions: vi.fn(),
}));

const getOptionsMock = vi.mocked(getWorkoutExerciseOptions);

const chestExercise: ExerciseDefinition = {
  id: 42,
  scope: 'global',
  name: 'Жим лёжа',
  description: 'Базовое упражнение',
  tracking_type: 'weight_reps',
  category_code: 'chest',
  equipment_code: 'barbell',
  reference_source: null,
  reference_key: null,
  reference_media_url: null,
  is_favourite: false,
  can_edit: false,
};

const armExercise: ExerciseDefinition = {
  ...chestExercise,
  id: 43,
  name: 'Сгибание рук',
  category_code: 'arms',
};

beforeEach(() => {
  getOptionsMock.mockReset();
});

afterEach(cleanup);

describe('WorkoutExercisePicker', () => {
  it('uses category-first navigation and confirms a multi-category selection only through OK', async () => {
    getOptionsMock.mockImplementation(async (_initData, categoryCode) => ({
      exercises: categoryCode === 'chest' ? [chestExercise] : categoryCode === 'arms' ? [armExercise] : [],
    }));
    const onConfirm = vi.fn();

    render(
      <WorkoutExercisePicker
        initData="telegram-init"
        isOpen
        saving={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Грудь')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(getOptionsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    expect(await screen.findByText('Жим лёжа')).toBeTruthy();
    expect(getOptionsMock).toHaveBeenCalledWith('telegram-init', 'chest');

    const chestRow = screen.getByRole('button', { name: /^Жим лёжа/ });
    fireEvent.click(chestRow);
    expect(chestRow.getAttribute('aria-pressed')).toBe('true');
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Назад к категориям' }));
    fireEvent.click(screen.getByRole('button', { name: 'Руки' }));
    expect(await screen.findByText('Сгибание рук')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Сгибание рук/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранные упражнения' }));
    expect(onConfirm).toHaveBeenCalledWith([42, 43]);
  });

  it('keeps the row selection control independent from its trailing menu action', async () => {
    getOptionsMock.mockResolvedValue({ exercises: [chestExercise] });

    render(
      <WorkoutExercisePicker
        initData="telegram-init"
        isOpen
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    const row = await screen.findByRole('button', { name: /^Жим лёжа/ });
    const action = screen.getByRole('button', { name: 'Действия: Жим лёжа' });

    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(action);
    const menuItem = await screen.findByRole('menuitem', { name: 'Снять выбор' });
    fireEvent.click(menuItem);

    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Добавить выбранные упражнения' })).toBeNull();
  });

  it('restores the green-dot selection after category navigation', async () => {
    getOptionsMock.mockResolvedValue({ exercises: [chestExercise] });

    render(
      <WorkoutExercisePicker
        initData="telegram-init"
        isOpen
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    const row = await screen.findByRole('button', { name: /^Жим лёжа/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Назад к категориям' }));
    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    const restoredRow = await screen.findByRole('button', { name: /^Жим лёжа/ });
    expect(restoredRow.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps selection and the selector open when confirmation error is rendered', async () => {
    getOptionsMock.mockResolvedValue({ exercises: [chestExercise] });
    const props = {
      initData: 'telegram-init',
      isOpen: true,
      saving: false,
      onConfirm: vi.fn(),
      onClose: vi.fn(),
    };
    const view = render(<WorkoutExercisePicker {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    const row = await screen.findByRole('button', { name: /^Жим лёжа/ });
    fireEvent.click(row);

    view.rerender(<WorkoutExercisePicker {...props} actionError="Не удалось добавить упражнения" />);

    expect(screen.getByRole('alert').textContent).toContain('Не удалось добавить упражнения');
    expect(screen.getByRole('button', { name: /^Жим лёжа/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
