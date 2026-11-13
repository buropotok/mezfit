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
  it('uses UI kit list primitives and renders FACT with PLAN but without PREVIOUS', () => {
    const { container } = renderExercise();

    const card = container.querySelector('.session-exercise');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('ui-surface')).toBe(false);
    expect(card?.classList.contains('session-exercise--surface')).toBe(true);
    expect(screen.getByText('Жим лёжа').closest('.ui-list-item')).not.toBeNull();
    expect(screen.getByText('Грудь · Штанга · 2 подхода')).toBeTruthy();
    expect(screen.getByText('1 / 2').className).toContain('ui-badge');
    expect(screen.getByText('Опускание 3 сек').className).toContain('ui-text--footnote');
    expect(screen.getByText('82,5 кг × 10').classList.contains('ui-text--headline')).toBe(true);
    expect(screen.getAllByText('План:')).toHaveLength(2);
    expect(screen.getByText('80 кг × 10').classList.contains('ui-text--body')).toBe(true);
    expect(screen.queryByText(/Пред\.:/)).toBeNull();
    expect(screen.getByText('RPE 8').className).toContain('ui-badge');
    expect(screen.getByText('50% выполнено')).toBeTruthy();
  });

  it('lays out two-line PLAN at left and FACT / entry prompt at right without PREVIOUS or set titles', () => {
    const { container } = renderExercise();
    const rows = container.querySelectorAll<HTMLElement>('.session-exercise__set-row');
    expect(rows).toHaveLength(2);

    const recorded = rows[0];
    const fact = within(recorded).getByText('82,5 кг × 10');
    const planHeading = within(recorded).getByText('План:');
    const planValue = within(recorded).getByText('80 кг × 10');
    expect(fact.classList.contains('ui-text--headline')).toBe(true);
    expect(fact.closest('.session-exercise__set-summary')).not.toBeNull();
    expect(fact.closest('.session-exercise__set-plan-block')).toBeNull();
    expect(planHeading.classList.contains('ui-text--caption')).toBe(true);
    expect(planValue.classList.contains('ui-text--body')).toBe(true);
    const planBlock = planHeading.parentElement!;
    const summary = planBlock.parentElement!;
    expect(planBlock.classList.contains('session-exercise__set-plan-block')).toBe(true);
    expect(planValue.parentElement).toBe(planBlock);
    expect(summary.classList.contains('session-exercise__set-summary')).toBe(true);
    expect(fact.parentElement?.parentElement).toBe(summary);
    expect(summary.firstElementChild).toBe(planBlock);
    expect(summary.lastElementChild).toBe(fact.parentElement);
    expect(within(recorded).getByText('RPE 8').closest('.ui-list-item__trailing')).not.toBeNull();
    expect(within(recorded).queryByText(/Пред\.:|Подход 1/)).toBeNull();

    const pending = rows[1];
    const heading = within(pending).getByText('План:');
    const placeholder = within(pending).getByText('Ввести факт');
    const value = within(pending).getByText('85 кг × 8');
    const pendingPlan = heading.parentElement!;
    const pendingSummary = pendingPlan.parentElement!;
    expect(value.parentElement).toBe(pendingPlan);
    expect(pendingSummary.firstElementChild).toBe(pendingPlan);
    expect(pendingSummary.lastElementChild).toBe(placeholder);
    expect(placeholder.parentElement).toBe(pendingSummary);
    expect(within(pending).queryByText(/Пред\.:|Подход 2/)).toBeNull();
  });

  it('prioritizes a wrapped FACT by hiding its whole PLAN block without shrinking the FACT font', async () => {
    const originalStyle = window.getComputedStyle.bind(window);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      if (element.classList.contains('ui-text--headline')) {
        return { fontSize: '24px', lineHeight: '30px' } as CSSStyleDeclaration;
      }
      return originalStyle(element, pseudoElement);
    });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('session-exercise__set-fact')) return { height: 65 } as DOMRect;
      return originalRect.call(this);
    });
    try {
      const { container } = renderExercise();
      const recorded = container.querySelectorAll<HTMLElement>('.session-exercise__set-row')[0];
      await waitFor(() => expect(within(recorded).queryByText('План:')).toBeNull());
      expect(within(recorded).queryByText('80 кг × 10')).toBeNull();
      expect(within(recorded).getByText('82,5 кг × 10').classList.contains('ui-text--headline')).toBe(true);
      expect(within(recorded).getByText('RPE 8')).toBeTruthy();
    } finally {
      styleSpy.mockRestore();
      rectSpy.mockRestore();
    }
  });

  it('gives FACT the available width when the left two-line PLAN would squeeze it', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('session-exercise__set-summary')) return { width: 175 } as DOMRect;
      if (this.classList.contains('session-exercise__set-plan-block')) return { width: 85 } as DOMRect;
      if (this.classList.contains('session-exercise__set-fact')) return { width: 140 } as DOMRect;
      return originalRect.call(this);
    });
    try {
      const { container } = renderExercise();
      const recorded = container.querySelectorAll<HTMLElement>('.session-exercise__set-row')[0];
      expect(within(recorded).queryByText('План:')).toBeNull();
      expect(within(recorded).queryByText('80 кг × 10')).toBeNull();
      expect(within(recorded).getByText('82,5 кг × 10').classList.contains('ui-text--headline')).toBe(true);
      expect(within(recorded).getByText('RPE 8')).toBeTruthy();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('keeps FACT visible without PLAN and reserves PREVIOUS for the set detail sheet', () => {
    const noPlan: SessionExerciseData = {
      ...data, sets: [{ ...data.sets[0], plan: null }],
    };
    const { container } = renderExercise({ data: noPlan });
    const row = container.querySelector<HTMLElement>('.session-exercise__set-row');
    expect(row).not.toBeNull();
    expect(within(row!).queryByText(/^План:|Пред\.:/)).toBeNull();
    expect(within(row!).getByText('82,5 кг × 10').closest('.session-exercise__set-summary')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    expect(screen.getByText('Пред.: 77,5 кг × 10')).toBeTruthy();
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

  it('keeps read-only sets inspectable without exposing FACT or structural mutations', () => {
    const { onSaveSet } = renderExercise({ editable: false, onAddSet: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Добавить подход' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Свернуть упражнение' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    const sheet = screen.getByRole('dialog', { name: 'Подход 1' });
    expect(within(sheet).getByText('Просмотр результата')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Изменить вес и повторения' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(sheet).queryByRole('button', { name: 'Удалить подход' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Закрыть подход' }));
    expect(screen.queryByRole('alertdialog', { name: 'Сохранить изменения?' })).toBeNull();
    expect(onSaveSet).not.toHaveBeenCalled();
  });
});

describe('SessionExercise and SetEntry boundary', () => {
  it('opens SetEntry from a set row and emits only persistence identity plus FACT to the workout owner', async () => {
    const { onSaveSet } = renderExercise();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    expect(screen.getByRole('dialog', { name: 'Подход 2' })).toBeTruthy();
    expect(screen.getByText('Силовой блок')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');

    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    expect(onSaveSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));

    await waitFor(() => expect(onSaveSet).toHaveBeenCalledTimes(1));
    expect(onSaveSet).toHaveBeenCalledWith({
      workoutSessionId: 100,
      sessionExerciseId: 200,
      sessionSetId: 302,
      fact: {
        metrics: {
          weightKg: null,
          reps: null,
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
      .toContain('Введите факт');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
    const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Изменить повторения' }));
    const input = within(picker).getByRole('textbox', { name: 'Ввести повторения' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(within(picker).getByRole('button', { name: 'Сохранить' }));
    expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent)
      .toContain('85 кг × 9');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Подход 2' })).toBeNull());

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

it('shows the complete FACT before RPE in the result area', () => {
  renderExercise();
  const row = screen.getByRole('button', { name: 'Открыть подход 1' });
  const result = within(row).getByText('82,5 кг × 10');
  const rpe = within(row).getByText('RPE 8');
  expect(result.compareDocumentPosition(rpe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(result.closest('.session-exercise__set-summary')).not.toBeNull();
  expect(rpe.closest('.ui-list-item__trailing')).not.toBeNull();
  expect(row.classList.contains('ui-list-item--content-trailing')).toBe(false);
});

describe('planned session with an empty projected FACT object', () => {
  // AdHocWorkoutRepository.project always supplies factOf(set), including pending sets.
  const pending: SessionExerciseData = {
    ...data,
    sets: [{
      ...data.sets[1],
      plan: { weightKg: 23, reps: 5, durationSeconds: null, distanceMeters: null },
      fact: {
        metrics: { weightKg: null, reps: null, durationSeconds: null, distanceMeters: null },
        setLabel: null, setType: null, rpe: null, comment: null, bands: [],
      },
    }],
  };

  it.each(['dismiss', 'save', 'retype'] as const)(
    'offers PLAN 23 × 5 only in picker and accepts it as FACT via %s', async action => {
      const { onSaveSet } = renderExercise({ data: pending });
      const row = screen.getByRole('button', { name: 'Открыть подход 2' });
      expect(within(row).getByText('Ввести факт')).toBeTruthy();
      expect(within(row).getByText('План:')).toBeTruthy();
       expect(within(row).getByText('23 кг × 5')).toBeTruthy();
      fireEvent.click(row);
      expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');
      fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
      expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('5');
      expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('23');
      for (const name of ['Изменить повторения', 'Изменить целые килограммы']) {
        expect(screen.getByRole('button', { name }).querySelector('.ui-icon')).toBeNull();
      }
      if (action === 'dismiss') {
        const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
        fireEvent.click(picker.previousElementSibling as Element);
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
        if (action === 'retype') {
          fireEvent.click(screen.getByRole('button', { name: 'Очистить ввод' }));
          fireEvent.click(screen.getByRole('button', { name: 'Цифра 5' }));
        }
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
      }
      expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('23 кг × 5');
      expect(onSaveSet).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
      expect(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' }).classList.contains('invisible')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Да' }));
      await waitFor(() => expect(onSaveSet).toHaveBeenCalledExactlyOnceWith({
        workoutSessionId: 100, sessionExerciseId: 200, sessionSetId: 302,
        fact: { metrics: pending.sets[0].plan,
          setLabel: null, setType: null, rpe: null, comment: null, bands: [] },
      }));
      expect(pending.sets[0].fact?.metrics.weightKg).toBeNull();
      expect(pending.sets[0].fact?.metrics.reps).toBeNull();
      expect(pending.sets[0].plan?.weightKg).toBe(23);
    },
  );

  it('discards picker input on Cancel and does not record the prefilled PLAN', () => {
    const { onSaveSet } = renderExercise({ data: pending });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ввести повторения' }), {
      target: { value: '9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');
    expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(screen.queryByRole('dialog', { name: 'Подход 2' })).toBeNull();
    expect(onSaveSet).not.toHaveBeenCalled();
  });
});


it('keeps FACT row openable by tapping the row, with no chevron when a discussion button is present', () => {
  const withDiscussion = { ...data, sets: data.sets.map((set, index) => ({
    ...set, discussionAnchor: { kind: 'set' as const,
      workout: { kind: 'session' as const, id: 'workout-1' },
      exercise: { kind: 'execution' as const, id: 'exercise-1' },
      set: { kind: 'execution' as const, id: String(index + 1) } },
  })) };
  render(<SessionExercise context={context} data={withDiscussion} defaultCollapsed={false}
    discussionScope={{ realmId: 'pair', coachClientId: 'pair' }}
    onOpenDiscussion={vi.fn()} onSaveSet={vi.fn(async () => {})} />);
  const row = screen.getByRole('button', { name: 'Открыть подход 1' });
  expect(row.querySelector('.session-exercise__icon--chevron-right')).toBeNull();
  expect(screen.getByRole('button', { name: 'Обсуждения подхода 1' })).toBeTruthy();
  fireEvent.click(row);
  expect(screen.getByRole('dialog', { name: 'Подход 1' })).toBeTruthy();
});


describe('exercise discussion deep-link highlight in FACT', () => {
  it('highlights only the GIF/name header when arriving at an exercise', () => {
    const save = vi.fn(async () => undefined);
    const view = render(<SessionExercise context={context} data={data} onSaveSet={save}
      defaultCollapsed={false} focusHeader />);
    const headerFocus = view.container.querySelector('.session-exercise__header-list .discussion-set-focus');
    expect(headerFocus?.querySelector('.session-exercise__header-toggle')).not.toBeNull();
    expect(headerFocus?.textContent).toContain('Жим лёжа');
    expect(headerFocus?.querySelector('.discussion-set-focus__flash')).not.toBeNull();
    expect(view.container.querySelector('.session-exercise__sets .discussion-set-focus')).toBeNull();
    fireEvent.click(screen.getByText('Жим лёжа'));
    expect(screen.getByRole('button', { name: 'Развернуть упражнение' })).toBeTruthy();
  });

  it('highlights a FACT approach without flashing its containing exercise header', () => {
    const save = vi.fn(async () => undefined);
    const view = render(<SessionExercise context={context} data={data} onSaveSet={save}
      defaultCollapsed={false} focusSetId={302} />);
    expect(view.container.querySelector('.session-exercise__header-list .discussion-set-focus')).toBeNull();
    const flash = view.container.querySelector('.session-exercise__sets .discussion-set-focus__flash');
    expect(flash).not.toBeNull();
    expect(flash?.closest('.discussion-set-focus')?.querySelector('[aria-label="Открыть подход 2"]')).not.toBeNull();
  });
});
