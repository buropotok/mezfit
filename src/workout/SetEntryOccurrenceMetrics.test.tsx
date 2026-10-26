// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetEntry } from './SetEntry';
import type { SetEntryData } from './setEntryTypes';

afterEach(() => cleanup());

const base: SetEntryData = {
  identity: { programId: 'program', programName: 'Сила', exerciseDefinitionId: 'exercise',
    exerciseName: 'Упражнение', setNumber: 2, workoutDate: '2026-10-26',
    sourceProgramSetId: 'template-set', sessionSetId: null },
  trackingType: 'time',
  setType: null,
  plan: { durationSeconds: 125, distanceMeters: 2500, reps: 8, weightKg: 70.75 },
  previous: null, fact: null,
};

describe('scheduled occurrence PLAN for non-weight/reps tracking', () => {
  it.each([
    ['time', ['Изменить продолжительность']],
    ['time_distance', ['Изменить продолжительность', 'Изменить дистанцию']],
    ['time_reps', ['Изменить продолжительность', 'Изменить повторения']],
    ['time_weight', ['Изменить продолжительность', 'Изменить вес']],
  ] as const)('%s uses only its relevant UI Kit metric pickers', (trackingType, labels) => {
    const onPlanSave = vi.fn(async () => undefined);
    render(<SetEntry mode="occurrence-plan" isOpen
      data={{ ...base, trackingType }} onClose={vi.fn()} onPlanSave={onPlanSave} />);
    expect(screen.getByRole('dialog', { name: 'Подход 2' })).toBeTruthy();
    expect(screen.getByText('00:02:05')).toBeTruthy();
    for (const label of labels) {
      const button = screen.getByRole('button', { name: label });
      expect(button.getAttribute('aria-disabled')).toBe('false');
    }
    expect(screen.getAllByRole('button', { name: /^Изменить / })).toHaveLength(labels.length);
    expect(screen.queryByRole('group', { name: 'RPE' })).toBeNull();
    expect(screen.queryByText('Фиксация результата')).toBeNull();
    expect(onPlanSave).not.toHaveBeenCalled();
  });

  it('persists duration and distance only in the supplied scheduled occurrence PLAN callback', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="occurrence-plan" isOpen
      data={{ ...base, trackingType: 'time_distance' }} onClose={onClose} onPlanSave={onPlanSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onPlanSave).toHaveBeenLastCalledWith(expect.objectContaining({
      durationSeconds: 125, distanceMeters: 2500, setType: 'cluster',
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('keeps an unsupported historical duration unchanged and disables its picker', () => {
    const onPlanSave = vi.fn(async () => undefined);
    render(<SetEntry mode="occurrence-plan" isOpen
      data={{ ...base, trackingType: 'time',
        plan: { ...base.plan!, durationSeconds: 90000 } }}
      onClose={vi.fn()} onPlanSave={onPlanSave} />);
    const trigger = screen.getByRole('button', { name: 'Изменить продолжительность' });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('90000')).toBeTruthy();
    fireEvent.click(trigger);
    expect(onPlanSave).not.toHaveBeenCalled();
  });
});
