// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkoutExerciseOptions } from '../api';
import { WorkoutExercisePicker } from './WorkoutExercisePicker';

vi.mock('../api', () => ({
  getWorkoutExerciseOptions: vi.fn(),
}));

const getOptionsMock = vi.mocked(getWorkoutExerciseOptions);

beforeEach(() => {
  getOptionsMock.mockReset();
});

afterEach(cleanup);

describe('WorkoutExercisePicker', () => {
  it('loads exercises through the workout API and emits the selected definition id', async () => {
    getOptionsMock.mockResolvedValue({
      exercises: [{
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
      }],
    });
    const onAdd = vi.fn();

    render(
      <WorkoutExercisePicker
        initData="telegram-init"
        isOpen
        addingExerciseId={null}
        onAdd={onAdd}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Жим лёжа')).toBeTruthy();
    expect(getOptionsMock).toHaveBeenCalledWith('telegram-init', '');
    fireEvent.click(screen.getByRole('button', { name: /Жим лёжа/ }));
    expect(onAdd).toHaveBeenCalledWith(42);
  });

  it('searches without replacing the picker surface and keeps add errors visible', async () => {
    getOptionsMock.mockResolvedValue({ exercises: [] });

    render(
      <WorkoutExercisePicker
        initData="telegram-init"
        isOpen
        addingExerciseId={null}
        actionError="Не удалось добавить упражнение"
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск упражнения' }), { target: { value: 'тяга' } });
    await waitFor(() => expect(getOptionsMock).toHaveBeenLastCalledWith('telegram-init', 'тяга'));
    expect(screen.getByRole('alert').textContent).toContain('Не удалось добавить упражнение');
  });
});
