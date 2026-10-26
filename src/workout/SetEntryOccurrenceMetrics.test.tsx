// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(onPlanSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onPlanSave).toHaveBeenLastCalledWith(expect.objectContaining({
      durationSeconds: 125, distanceMeters: 2500, setType: 'cluster',
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('never autosaves time-based PLAN and never closes its picker during editing', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="occurrence-plan" isOpen
      data={{ ...base, trackingType: 'time_distance' }}
      onClose={onClose} onPlanSave={onPlanSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить продолжительность' }));
    const picker = screen.getByRole('dialog', { name: 'Выбор продолжительности' });
    await new Promise<void>(resolve => { window.setTimeout(resolve, 440); });
    expect(onPlanSave).not.toHaveBeenCalled();
    // The wheel must still accept an edit after the old background-save interval.
    const minutes = within(picker).getByRole('listbox', { name: 'Минуты продолжительности' });
    fireEvent.click(within(minutes).getByRole('option', { name: '03' }));
    expect(screen.getByText('00:03:05')).toBeTruthy();
    expect(onPlanSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(screen.getByText('Изменения не сохранятся!')).toBeTruthy();
    expect(onPlanSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onPlanSave).not.toHaveBeenCalled();
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
    expect(screen.getByText('00:02:05')).toBeTruthy();
    expect(screen.getByText('2 км 500 м')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Записать значения плана как факт' })).toBeNull();
    fireEvent.input(screen.getByRole<HTMLInputElement>('slider', { name: 'RPE' }),
      { target: { value: '9' } });
    expect(screen.getByText('RPE: 9')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save.querySelector('.ui-text--body')).not.toBeNull();
    fireEvent.click(save);
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
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      setLabel: 'warmup', rpe: null, setType: null,
      metrics: { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: 2500 },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it.each([
    ['time', { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: null }],
    ['time_distance', { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: 2500 }],
    ['time_reps', { weightKg: null, reps: 8, durationSeconds: 125, distanceMeters: null }],
    ['time_weight', { weightKg: 70.75, reps: null, durationSeconds: 125, distanceMeters: null }],
  ] as const)('%s records relevant PLAN values as FACT with Save only, even without edits', async (trackingType, expectedMetrics) => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen
        data={{ ...base, trackingType, fact: null }}
        onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    expect(screen.queryByRole('button', { name: /Записать.*как факт/ })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      rpe: null, metrics: expectedMetrics,
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it.each([
    ['time', '00:02:30', null],
    ['time_distance', '00:02:30', '3 км 000 м'],
    ['time_reps', '00:02:30', '12'],
    ['time_weight', '00:02:30', '80,75 кг'],
  ] as const)('%s displays previously saved FACT, not PLAN, on reopen', (trackingType, first, second) => {
    const onSave = vi.fn(async () => undefined);
    render(<SetEntry mode="workout" isOpen
      data={{ ...base, trackingType, fact: {
        metrics: { durationSeconds: 150, distanceMeters: 3000, reps: 12, weightKg: 80.75 },
        setLabel: 'hard', setType: 'cluster', rpe: 6, comment: 'Выполнено', bands: [],
      } }} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByText(first)).toBeTruthy();
    if (second) {
      const target = trackingType === 'time_distance' ? 'Изменить дистанцию'
        : trackingType === 'time_reps' ? 'Изменить повторения' : 'Изменить вес';
      expect(within(screen.getByRole('button', { name: target })).getByText(second)).toBeTruthy();
    }
    expect(screen.getByText('RPE: 6')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Кластер' }).getAttribute('aria-pressed')).toBe('true');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('uses semantic Mezfit typography for scheduled PLAN deletion dialog', () => {
    render(<SetEntry mode="occurrence-plan" isOpen
      data={{ ...base, trackingType: 'time' }}
      onClose={vi.fn()} onPlanSave={vi.fn(async () => undefined)}
      onDeleteSet={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход' }));
    expect(screen.getByText('Удалить подход?').className).toContain('ui-text--headline');
    expect(screen.getByRole('button', { name: 'Отмена' }).querySelector('.ui-text--body')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Удалить' }).querySelector('.ui-text--body')).not.toBeNull();
  });

  it('shows discard confirmation for edited time-based FACT and never writes on X', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen
        data={{ ...base, trackingType: 'time_distance' }}
        onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(screen.getByText('Изменения не сохранятся!')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('never autosaves edits in time-based FACT before an explicit Save action', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{ ...base, trackingType: 'time' }}
        onClose={vi.fn()} onSave={onSave} />
    </KonstaProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    await new Promise<void>(resolve => { window.setTimeout(resolve, 400); });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
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
