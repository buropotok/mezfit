// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseDefinition } from '../api';
import { SessionExercise, formatSessionSetMetrics } from './SessionExercise';
import type { SessionExerciseContext, SessionExerciseData } from './sessionExerciseTypes';

const exercise: ExerciseDefinition = {
  id: 20,
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

const context: SessionExerciseContext = {
  workoutSessionId: 100,
  workoutDate: '2026-09-15',
  program: { id: 10, name: 'Силовой блок' },
};

const data: SessionExerciseData = {
  sessionExerciseId: 200,
  workoutSessionId: 100,
  sourceProgramExerciseId: 30,
  position: 0,
  status: 'active',
  notes: 'Опускание 3 сек',
  exercise,
  sets: [
    {
      sessionSetId: 301,
      sourceProgramSetId: 401,
      position: 0,
      status: 'completed',
      plan: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
      previous: {
        workoutDate: '2026-09-08',
        metrics: { weightKg: 77.5, reps: 10, durationSeconds: null, distanceMeters: null },
      },
      fact: {
        metrics: { weightKg: 82.5, reps: 10, durationSeconds: null, distanceMeters: null },
        setLabel: 'hard',
        rpe: 8,
        comment: null,
        bands: [],
      },
    },
    {
      sessionSetId: 302,
      sourceProgramSetId: 402,
      position: 1,
      status: 'pending',
      plan: { weightKg: 85, reps: 8, durationSeconds: null, distanceMeters: null },
      previous: {
        workoutDate: '2026-09-08',
        metrics: { weightKg: 82.5, reps: 8, durationSeconds: null, distanceMeters: null },
      },
      fact: null,
    },
  ],
};

function renderExercise(overrides?: { context?: SessionExerciseContext; data?: SessionExerciseData; defaultCollapsed?: boolean }) {
  const onSaveSet = vi.fn(async () => undefined);
  const onOpenExerciseMenu = vi.fn();
  const onOpenHistory = vi.fn();
  const onOpenChat = vi.fn();

  const view = render(
    <SessionExercise
      context={overrides?.context ?? context}
      data={overrides?.data ?? data}
      defaultCollapsed={overrides?.defaultCollapsed}
      onSaveSet={onSaveSet}
      onOpenExerciseMenu={onOpenExerciseMenu}
      onOpenHistory={onOpenHistory}
      onOpenChat={onOpenChat}
    />,
  );

  return { ...view, onSaveSet, onOpenExerciseMenu, onOpenHistory, onOpenChat };
}

afterEach(() => cleanup());

describe('SessionExercise rendering', () => {
  it('uses UI kit list primitives and renders session PLAN, PREVIOUS and FACT', () => {
    const { container } = renderExercise();

    const card = container.querySelector('.session-exercise');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('ui-surface')).toBe(false);
    expect(screen.getByText('Жим лёжа').closest('.ui-list-item')).not.toBeNull();
    expect(screen.getByText('Грудь · Штанга · 2 подхода')).toBeTruthy();
    expect(screen.getByText('1 / 2').className).toContain('ui-badge');
    expect(screen.getByText('Опускание 3 сек').className).toContain('ui-text--footnote');
    expect(screen.getByText('82,5 кг × 10')).toBeTruthy();
    expect(screen.getByText('План: 80 кг × 10')).toBeTruthy();
    expect(screen.getByText('Пред.: 77,5 кг × 10')).toBeTruthy();
    expect(screen.getByText('RPE 8').className).toContain('ui-badge');
    expect(screen.getByText('50% выполнено')).toBeTruthy();
  });

  it('collapses and expands from a short header click', () => {
    renderExercise();
    const header = screen.getByText('Жим лёжа').closest('button');
    expect(header).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();

    fireEvent.click(header!);
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
    expect(header?.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(header!);
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
  });

  it('starts collapsed when requested', () => {
    renderExercise({ defaultCollapsed: true });
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
    expect(screen.getByText('Жим лёжа').closest('button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the exercise menu as an external action', () => {
    const { onOpenExerciseMenu } = renderExercise();
    fireEvent.click(screen.getByRole('button', { name: 'Опции упражнения' }));
    expect(onOpenExerciseMenu).toHaveBeenCalledWith(200);
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
  });
});

describe('SessionExercise and SetEntry boundary', () => {
  it('opens SetEntry from a set row and emits only persistence identity plus FACT to the workout owner', async () => {
    const { onSaveSet } = renderExercise();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    expect(screen.getByRole('heading', { name: 'Подход 2' })).toBeTruthy();
    expect(screen.getByText(/Силовой блок · 15 сентября 2026/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Вес, КГ'), { target: { value: '87.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onSaveSet).toHaveBeenCalledTimes(1));
    expect(onSaveSet).toHaveBeenCalledWith({
      workoutSessionId: 100,
      sessionExerciseId: 200,
      sessionSetId: 302,
      fact: {
        metrics: {
          weightKg: 87.5,
          reps: 8,
          durationSeconds: null,
          distanceMeters: null,
        },
        setLabel: null,
        rpe: null,
        comment: null,
        bands: [],
      },
    });
  });

  it('supports an exercise from an own workout without program PLAN', () => {
    const ownContext: SessionExerciseContext = {
      ...context,
      program: null,
    };
    const ownData: SessionExerciseData = {
      ...data,
      sourceProgramExerciseId: null,
      sets: [{
        ...data.sets[1],
        sourceProgramSetId: null,
        plan: null,
        previous: null,
      }],
    };

    renderExercise({ context: ownContext, data: ownData });
    expect(screen.queryByText(/^План:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    expect(screen.getByText(/15 сентября 2026/)).toBeTruthy();
    expect(screen.queryByText(/Своя тренировка/)).toBeNull();
  });

  it('bubbles history and chat actions from SetEntry to their external owners', () => {
    const { onOpenHistory, onOpenChat } = renderExercise();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'История упражнения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));

    expect(onOpenHistory).toHaveBeenCalledWith(20);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });
});

describe('SessionExercise metric formatting', () => {
  it('formats time and distance using session canonical units', () => {
    expect(formatSessionSetMetrics({
      weightKg: null,
      reps: null,
      durationSeconds: 1122,
      distanceMeters: 3200,
    }, 'time_distance')).toBe('18:42 · 3,20 км');
  });
});
