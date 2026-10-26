// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseDefinition } from '../api';
import { SessionExercise, formatSessionSetMetrics } from './SessionExercise';
import type { SaveSessionSetInput, SessionExerciseContext, SessionExerciseData } from './sessionExerciseTypes';

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
        setLabel: null,
        setType: 'cluster',
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

function renderExercise(overrides?: {
  context?: SessionExerciseContext;
  data?: SessionExerciseData;
  defaultCollapsed?: boolean;
  surface?: 'default' | 'transparent';
  editable?: boolean;
  onAddSet?: (sessionExerciseId: number) => void;
  onInformation?: () => void;
}) {
  const onSaveSet = vi.fn(async () => undefined);
  const onOpenExerciseMenu = vi.fn();
  const onOpenHistory = vi.fn();
  const onOpenChat = vi.fn();

  const view = render(
    <SessionExercise
      context={overrides?.context ?? context}
      data={overrides?.data ?? data}
      defaultCollapsed={overrides?.defaultCollapsed ?? false}
      surface={overrides?.surface}
      editable={overrides?.editable}
      onAddSet={overrides?.onAddSet}
      onSaveSet={onSaveSet}
      onOpenExerciseMenu={onOpenExerciseMenu}
      onInformation={overrides?.onInformation}
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
    expect(card?.classList.contains('session-exercise--surface')).toBe(true);
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

  it('does not apply legacy surface geometry when an outer component owns the tile material', () => {
    const { container } = renderExercise({ surface: 'transparent' });
    const card = container.querySelector('.session-exercise');

    expect(card).not.toBeNull();
    expect(card?.classList.contains('session-exercise--surface')).toBe(false);
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

  it('defaults to collapsed, defers set rendering and retains mounted rows after first expand', () => {
    let factReads = 0;
    const lazyData: SessionExerciseData = {
      ...data,
      sets: [{
        ...data.sets[0],
        get fact() {
          factReads += 1;
          return data.sets[0].fact;
        },
      }],
    };
    const { container } = render(<SessionExercise context={context} data={lazyData}
      onSaveSet={vi.fn(async () => undefined)} />);

    expect(screen.getByRole('button', { name: 'Развернуть упражнение' })).toBeTruthy();
    expect(container.querySelector('.session-exercise__set-row')).toBeNull();
    expect(factReads).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть упражнение' }));
    const row = container.querySelector('.session-exercise__set-row');
    expect(row).not.toBeNull();
    expect(factReads).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть упражнение' }));
    expect(container.querySelector('.session-exercise__set-row')).toBe(row);
    expect(container.querySelector('.session-exercise__body')?.hasAttribute('hidden')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть упражнение' }));
    expect(container.querySelector('.session-exercise__set-row')).toBe(row);
  });

  it('supports external collapsed state without losing the mounted detail subtree', () => {
    const onSaveSet = vi.fn(async () => undefined);
    const view = (collapsed: boolean) => <SessionExercise context={context} data={data}
      onSaveSet={onSaveSet} collapsed={collapsed} />;
    const { container, rerender } = render(view(true));
    expect(container.querySelector('.session-exercise__set-row')).toBeNull();

    rerender(view(false));
    const row = container.querySelector('.session-exercise__set-row');
    expect(row).not.toBeNull();

    rerender(view(true));
    expect(container.querySelector('.session-exercise__set-row')).toBe(row);
    expect(container.querySelector('.session-exercise__body')?.hasAttribute('hidden')).toBe(true);
  });

  it('does not mount detail when an external owner rejects an expand request', () => {
    const onCollapsedChange = vi.fn();
    const { container } = render(<SessionExercise context={context} data={data}
      onSaveSet={vi.fn(async () => undefined)} collapsed onCollapsedChange={onCollapsedChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть упражнение' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Развернуть упражнение' })).toBeTruthy();
    expect(container.querySelector('.session-exercise__set-row')).toBeNull();
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

  it('uses the same media information callback without changing workout disclosure', () => {
    const onInformation = vi.fn();
    const { container } = renderExercise({ onInformation });
    const information = screen.getByRole('button', { name: 'Информация об упражнении: Жим лёжа' });
    expect(information.parentElement?.classList.contains('session-exercise__header-list')).toBe(true);
    expect(information.closest('.ui-list-item')).toBeNull();
    expect(information.closest('[aria-hidden="true"]')).toBeNull();
    expect(information.hasAttribute('data-no-dnd')).toBe(true);
    expect(container.querySelector('.ui-list-item__leading')).not.toBeNull();
    fireEvent.click(information);
    expect(onInformation).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
    fireEvent.click(screen.getByText('Жим лёжа').closest('button')!);
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
  });

  it('uses the full 44px row as the add-set action while keeping the glass plus as artwork', () => {
    const onAddSet = vi.fn();
    renderExercise({ onAddSet });

    const addSet = screen.getByRole('button', { name: 'Добавить подход' });
    expect(addSet.classList.contains('session-exercise__add-set-hit')).toBe(true);
    expect(addSet.querySelector('.session-exercise__add-set-button')).not.toBeNull();
    expect(addSet.parentElement?.classList.contains('session-exercise__add-set')).toBe(true);

    fireEvent.click(addSet);
    expect(onAddSet).toHaveBeenCalledWith(200);
  });

  it('removes structural and set editing actions when the exercise is read-only', () => {
    renderExercise({ editable: false, onAddSet: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Добавить подход' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Свернуть упражнение' })).toBeTruthy();
  });
});

describe('SessionExercise and SetEntry boundary', () => {
  it('opens SetEntry from a set row and emits only persistence identity plus FACT to the workout owner', async () => {
    const { onSaveSet } = renderExercise();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    expect(screen.getByRole('dialog', { name: 'Подход 2' })).toBeTruthy();
    expect(screen.getByText('Силовой блок')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    expect(onSaveSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onSaveSet).toHaveBeenCalledTimes(1));
    expect(onSaveSet).toHaveBeenCalledWith({
      workoutSessionId: 100,
      sessionExerciseId: 200,
      sessionSetId: 302,
      fact: {
        metrics: {
          weightKg: 85,
          reps: 8,
          durationSeconds: null,
          distanceMeters: null,
        },
        setLabel: null,
        setType: 'dropset',
        rpe: null,
        comment: null,
        bands: [],
      },
    });
  });

  it('reopens a saved FACT rather than reinitializing values from PLAN', async () => {
    const saved = vi.fn();
    function WorkoutOwner() {
      const [current, setCurrent] = useState<SessionExerciseData>(data);
      const onSaveSet = async (input: SaveSessionSetInput) => {
        saved(input);
        // The real WorkoutSessionScreen receives the authoritative saved session,
        // then rerenders SessionExercise with that saved FACT.
        setCurrent(previous => ({
          ...previous, sets: previous.sets.map(set => set.sessionSetId !== input.sessionSetId
            ? set : { ...set, status: 'completed', fact: input.fact }),
        }));
      };
      return <SessionExercise context={context} data={current}
        onSaveSet={onSaveSet} defaultCollapsed={false} />;
    }
    render(<WorkoutOwner />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent)
      .toContain('85 кг × 8');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
    const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
    const repetitions = within(picker).getByRole('listbox', { name: 'Повторения' });
    const nine = repetitions.querySelector<HTMLButtonElement>('button[aria-label="9"]');
    expect(nine).not.toBeNull();
    fireEvent.click(nine!);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent)
      .toContain('85 кг × 9');
    expect(within(screen.getByRole('dialog', { name: 'Подход 2' }))
      .getByText('План: 85 кг × 8')).toBeTruthy();
    expect(saved).toHaveBeenCalledOnce(); // reopening never writes another FACT
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
    expect(screen.getByRole('dialog', { name: 'Подход 2' })).toBeTruthy();
    expect(screen.queryByText(/Силовой блок/)).toBeNull();
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
