/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackingType } from '../api';
import { SetEntry } from './SetEntry';
import type { SetEntryData } from './setEntryTypes';

afterEach(cleanup);

const data = (trackingType: TrackingType): SetEntryData => ({
  identity: {
    programId: null, programName: null, exerciseDefinitionId: 1,
    exerciseName: 'Тренировка', setNumber: 1, workoutDate: '2026-10-26',
    sourceProgramSetId: null, sessionSetId: null,
  },
  trackingType, setType: null,
  plan: {
    weightKg: trackingType === 'weight_reps' || trackingType === 'time_weight' ? 70.75 : null,
    reps: trackingType === 'weight_reps' || trackingType === 'time_reps' ? 8 : null,
    durationSeconds: trackingType !== 'weight_reps' ? 125 : null,
    distanceMeters: trackingType === 'time_distance' ? 2500 : null,
  },
  fact: null, previous: null,
});

describe('all five tracking types use the approved UI Kit pickers', () => {
  it.each([
    ['weight_reps', ['Изменить вес и повторения'], '2 показателя'],
    ['time', ['Изменить время'], '1 показатель'],
    ['time_distance', ['Изменить время', 'Изменить дистанцию'], '2 показателя'],
    ['time_reps', ['Изменить время', 'Изменить повторения'], '2 показателя'],
    ['time_weight', ['Изменить время', 'Изменить вес'], '2 показателя'],
  ] as const)('%s opens its appropriate metrics without writing to the program', async (tracking, triggers, counter) => {
    const onPlanSave = vi.fn(async () => undefined);
    render(<SetEntry mode="occurrence-plan" isOpen data={data(tracking)}
      onClose={vi.fn()} onPlanSave={onPlanSave} />);
    expect(screen.getByText(counter)).toBeTruthy();
    for (const label of triggers) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: 'RPE' })).toBeNull();
    expect(onPlanSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onPlanSave).toHaveBeenCalledWith({
      ...data(tracking).plan!, setType: 'dropset',
    }));
  });

  it('shows the prescribed metric as comparison only in FACT and uses Mezfit small RPE slider', () => {
    const onSave = vi.fn(async () => undefined);
    render(<SetEntry mode="workout" isOpen data={data('time_distance')}
      onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Изменить время' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить дистанцию' })).toBeTruthy();
    const rpe = screen.getByRole('slider', { name: 'RPE' });
    expect(rpe.getAttribute('min')).toBe('0');
    expect(rpe.getAttribute('max')).toBe('10');
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
