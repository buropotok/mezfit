// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
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

  it('saves only the explicit FACT and RPE chosen through the Mezfit slider', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen
        data={{ ...base, trackingType: 'time_distance', fact: null }}
        onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    expect(screen.getByText('План: 00:02:05 · 2 км 500 м')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    const copyPlan = screen.getByRole('button', { name: 'Записать значения плана как факт' });
    // App-owned Konsta action labels must use Mezfit's semantic Body preset.
    expect(copyPlan.querySelector('.ui-text--body')?.textContent).toBe('Записать значения плана как факт');
    fireEvent.click(copyPlan);
    fireEvent.input(screen.getByRole<HTMLInputElement>('slider', { name: 'RPE' }),
      { target: { value: '9' } });
    expect(screen.getByText('RPE: 9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      setLabel: null, rpe: 9,
      metrics: { durationSeconds: 125, distanceMeters: 2500, reps: null, weightKg: null },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('preserves a historical setLabel when editing a non-weight FACT comment', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{
        ...base, trackingType: 'time',
        fact: {
          metrics: { weightKg: null, reps: null, durationSeconds: 150, distanceMeters: null },
          setLabel: 'hard', setType: null, rpe: 6, comment: null, bands: [],
        },
      }} onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    // Konsta's floating textarea label is visually present, but the input's
    // accessible name is empty in its current public ListInput contract.
    expect(screen.getByText('Как прошёл подход?')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Лучше предыдущего' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      setLabel: 'hard', rpe: 6, comment: 'Лучше предыдущего',
      metrics: { weightKg: null, reps: null, durationSeconds: 150, distanceMeters: null },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('clears existing RPE to null without erasing a historical setLabel', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{
        ...base, trackingType: 'time_distance',
        fact: {
          metrics: { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: 2500 },
          setLabel: 'warmup', setType: null, rpe: 7, comment: null, bands: [],
        },
      }} onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    expect(screen.getByText('RPE: 7')).toBeTruthy();
    fireEvent.input(screen.getByRole('slider', { name: 'RPE' }), { target: { value: '0' } });
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      setLabel: 'warmup', rpe: null, setType: null,
      metrics: { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: 2500 },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not write a FACT when a time-based set is opened and closed unchanged', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen
      data={{ ...base, trackingType: 'time' }} onClose={onClose} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
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
