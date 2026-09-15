import { renderToStaticMarkup } from 'react-dom/server';
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

function renderSetEntry(data: SetEntryData): string {
  return renderToStaticMarkup(
    <SetEntry
      data={data}
      onSave={vi.fn(async () => undefined)}
      onOpenHistory={vi.fn()}
      onOpenChat={vi.fn()}
    />,
  );
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
  it('renders metadata, PLAN and the analogous set from the previous workout', () => {
    const html = renderSetEntry(baseData);

    expect(html).toContain('Подход 3');
    expect(html).toContain('Жим лёжа');
    expect(html).toContain('Силовой блок');
    expect(html).toContain('15 сентября 2026');
    expect(html).toContain('План: 80 кг');
    expect(html).toContain('Предыдущая тренировка: 77,5 кг');
    expect(html).toContain('План: 10');
    expect(html).toContain('Предыдущая тренировка: 10');
  });

  it('uses the approved typography roles for the set title, exercise and metric labels', () => {
    const html = renderSetEntry(baseData);

    expect(html).toContain('ui-text--title ui-text--default">Подход 3');
    expect(html).toContain('ui-text--headline ui-text--default set-entry__exercise-name">Жим лёжа');
    expect(html).toContain('ui-text--headline ui-text--default set-entry__metric-label">Вес');
    expect(html).toContain('ui-text--headline ui-text--default set-entry__metric-label">Повторения');
  });

  it('renders only the inputs required by the tracking type', () => {
    const html = renderSetEntry({
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

    expect(html).toContain('Время');
    expect(html).toContain('Дистанция');
    expect(html).toContain('aria-label="Время, минуты"');
    expect(html).toContain('aria-label="Время, секунды"');
    expect(html).toContain('aria-label="Дистанция, КМ"');
    expect(html).not.toContain('aria-label="Вес, КГ"');
    expect(html).not.toContain('aria-label="Повторения, ПОВТ."');
  });

  it('keeps history and chat as external module actions', () => {
    const html = renderSetEntry(baseData);
    expect(html).toContain('aria-label="История упражнения"');
    expect(html).toContain('Открыть чат');
  });
});
