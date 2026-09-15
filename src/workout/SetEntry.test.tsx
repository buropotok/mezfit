// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetEntry } from './SetEntry';
import { createSetEntryDraft, type SetEntryData } from './setEntryTypes';

const baseData: SetEntryData = {
  identity: {
    programId: 10,
    programName: 'Силовой блок',
    exerciseDefinitionId: 20,
    exerciseName: 'Жим лёжа',
    setNumber: 3,
    workoutDate: '2026-09-15',
    sourceProgramSetId: 30,
    sessionSetId: null,
  },
  trackingType: 'weight_reps',
  plan: {
    weightKg: 80,
    reps: 10,
    durationSeconds: null,
    distanceMeters: null,
  },
  previous: {
    workoutDate: '2026-09-08',
    metrics: {
      weightKg: 77.5,
      reps: 10,
      durationSeconds: null,
      distanceMeters: null,
    },
  },
  fact: null,
};

function renderSetEntry(data: SetEntryData = baseData) {
  const onClose = vi.fn();
  const onSave = vi.fn(async () => undefined);
  const onOpenHistory = vi.fn();
  const onOpenChat = vi.fn();

  render(
    <SetEntry
      isOpen
      data={data}
      onClose={onClose}
      onSave={onSave}
      onOpenHistory={onOpenHistory}
      onOpenChat={onOpenChat}
    />,
  );

  return { onClose, onSave, onOpenHistory, onOpenChat };
}

describe('SetEntry contract', () => {
  it('uses existing FACT before PLAN when creating the editable draft', () => {
    const factMetrics = {
      weightKg: 82.5,
      reps: 8,
      durationSeconds: null,
      distanceMeters: null,
    };
    const draft = createSetEntryDraft({
      ...baseData,
      fact: {
        metrics: factMetrics,
        setLabel: 'hard',
        rpe: 9,
        comment: 'Последний повтор тяжёлый',
        bands: ['red'],
      },
    });

    expect(draft.metrics.weightKg).toBe(82.5);
    expect(draft.metrics.reps).toBe(8);
    expect(draft.metrics).not.toBe(factMetrics);
    expect(draft.setLabel).toBe('hard');
    expect(draft.rpe).toBe(9);
    expect(draft.bands).toEqual(['red']);
  });

  it('uses PLAN as the initial metrics when FACT does not exist without aliasing the read-only plan', () => {
    const draft = createSetEntryDraft(baseData);
    expect(draft.metrics.weightKg).toBe(80);
    expect(draft.metrics.reps).toBe(10);
    expect(draft.metrics).not.toBe(baseData.plan);
    expect(draft.setLabel).toBeNull();
    expect(draft.rpe).toBeNull();
  });
});

describe('SetEntry rendering', () => {
  it('renders the UI kit dialog with metadata, PLAN and the analogous set from the previous workout', () => {
    renderSetEntry();

    const dialog = screen.getByRole('dialog', { name: 'Подход 3' });
    expect(dialog.textContent).toContain('Жим лёжа');
    expect(dialog.textContent).toContain('Силовой блок');
    expect(dialog.textContent).toContain('15 сентября 2026');
    expect(dialog.textContent).toContain('План: 80 кг');
    expect(dialog.textContent).toContain('Предыдущая тренировка: 77,5 кг');
    expect(dialog.textContent).toContain('План: 10');
    expect(dialog.textContent).toContain('Предыдущая тренировка: 10');
  });

  it('reuses UI kit TextInput for numeric fields and Modal actions for save', () => {
    renderSetEntry();

    const weight = screen.getByLabelText('Вес, КГ');
    const reps = screen.getByLabelText('Повторения, ПОВТ.');
    expect(weight.className).toContain('ui-text-input__field');
    expect(reps.className).toContain('ui-text-input__field');
    expect(weight.closest('.ui-text-input')).not.toBeNull();
    expect(reps.closest('.ui-text-input')).not.toBeNull();

    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save.closest('.ui-modal__actions')).not.toBeNull();
  });

  it('uses the approved hierarchy for the modal, exercise and metric labels', () => {
    renderSetEntry();

    expect(screen.getByText('Подход 3').className).toContain('ui-modal__title');
    expect(screen.getByText('Жим лёжа').className).toContain('ui-text--headline');
    expect(screen.getByText('Вес').className).toContain('ui-text--headline');
    expect(screen.getByText('Повторения').className).toContain('ui-text--headline');
  });

  it('renders only the inputs required by the tracking type', () => {
    renderSetEntry({
      ...baseData,
      trackingType: 'time_distance',
      plan: {
        weightKg: null,
        reps: null,
        durationSeconds: 600,
        distanceMeters: 3000,
      },
      previous: {
        workoutDate: '2026-09-08',
        metrics: {
          weightKg: null,
          reps: null,
          durationSeconds: 540,
          distanceMeters: 2800,
        },
      },
    });

    expect(screen.getByText('Время')).toBeTruthy();
    expect(screen.getByText('Дистанция')).toBeTruthy();
    expect(screen.getByLabelText('Время, минуты')).toBeTruthy();
    expect(screen.getByLabelText('Время, секунды')).toBeTruthy();
    expect(screen.getByLabelText('Дистанция, КМ')).toBeTruthy();
    expect(screen.queryByLabelText('Вес, КГ')).toBeNull();
    expect(screen.queryByLabelText('Повторения, ПОВТ.')).toBeNull();
  });

  it('keeps history and chat as external module actions', () => {
    const { onOpenHistory, onOpenChat } = renderSetEntry();

    fireEvent.click(screen.getByRole('button', { name: 'История упражнения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));

    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('passes the complete editable FACT through the modal save action', async () => {
    const { onSave } = renderSetEntry();

    fireEvent.change(screen.getByLabelText('Вес, КГ'), { target: { value: '82.5' } });
    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Хороший подход' } });
    fireEvent.click(screen.getByRole('button', { name: 'Тяжело' }));
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      metrics: {
        weightKg: 82.5,
        reps: 10,
        durationSeconds: null,
        distanceMeters: null,
      },
      setLabel: 'hard',
      rpe: 8,
      comment: 'Хороший подход',
      bands: [],
    });
  });
});
