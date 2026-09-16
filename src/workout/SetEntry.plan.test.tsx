// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoachProgramSet } from '../api';
import { SetEntry } from './SetEntry';
import type { SetEntryData } from './setEntryTypes';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    createCoachProgramSet: vi.fn(async () => ({
      set: {
        id: 1,
        programExerciseId: 44,
        setNumber: 2,
        weightKg: 80,
        reps: 8,
        durationSeconds: null,
        distanceMeters: null,
      },
    })),
  };
});

vi.mock('../telegram', () => ({
  getTelegramWebApp: () => ({ initData: 'signed-init-data' }),
}));

const data: SetEntryData = {
  identity: {
    programId: 10,
    programName: 'Силовой блок',
    exerciseDefinitionId: 20,
    exerciseName: 'Жим лёжа',
    setNumber: 2,
    workoutDate: '2026-09-15',
    sourceProgramSetId: null,
    sessionSetId: null,
  },
  trackingType: 'weight_reps',
  plan: null,
  previous: {
    workoutDate: '2026-09-08',
    metrics: { weightKg: 77.5, reps: 8, durationSeconds: null, distanceMeters: null },
  },
  fact: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SetEntry plan mode', () => {
  it('keeps previous workout context and omits separate PLAN, assessment and RPE', () => {
    render(
      <SetEntry
        mode="plan"
        programExerciseId={44}
        isOpen
        data={data}
        onClose={vi.fn()}
        onOpenHistory={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );

    expect(screen.getByText('Предыдущая тренировка: 77,5 кг')).toBeTruthy();
    expect(screen.getByText('Предыдущая тренировка: 8')).toBeTruthy();
    expect(screen.queryByText(/^План:/)).toBeNull();
    expect(screen.queryByText('Оценка подхода')).toBeNull();
    expect(screen.queryByText('RPE')).toBeNull();
  });

  it('posts authored metrics with the program exercise parent identity', async () => {
    const onClose = vi.fn();
    render(
      <SetEntry
        mode="plan"
        programExerciseId={44}
        isOpen
        data={data}
        onClose={onClose}
        onOpenHistory={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Вес, КГ'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(createCoachProgramSet).toHaveBeenCalledTimes(1));
    expect(createCoachProgramSet).toHaveBeenCalledWith('signed-init-data', 44, {
      setNumber: 2,
      weightKg: 80,
      reps: null,
      durationSeconds: null,
      distanceMeters: null,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
