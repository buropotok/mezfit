// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetEntry } from './SetEntry';
import { createSetEntryDraft, type SetEntryData } from './setEntryTypes';

const baseData: SetEntryData = {
  identity: {
    programId: 10, programName: 'Силовой блок', exerciseDefinitionId: 20,
    exerciseName: 'Жим лёжа', setNumber: 3, workoutDate: '2026-09-15',
    sourceProgramSetId: 30, sessionSetId: null,
  },
  trackingType: 'weight_reps',
  plan: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
  previous: { workoutDate: '2026-09-08', metrics: {
    weightKg: 77.5, reps: 10, durationSeconds: null, distanceMeters: null,
  } },
  fact: null,
};

afterEach(() => cleanup());

describe('weight and repetitions SetEntry', () => {
  it('initializes FACT from existing measurements before the read-only PLAN', () => {
    const fact = { weightKg: 82.5, reps: 8, durationSeconds: null, distanceMeters: null };
    const draft = createSetEntryDraft({ ...baseData, setType: 'dropset', fact: {
      metrics: fact, setLabel: null, setType: 'cluster', rpe: 9,
      comment: 'Последний повтор', bands: ['red'],
    } });
    expect(draft.metrics).toEqual(fact);
    expect(draft.metrics).not.toBe(fact);
    expect(draft.setType).toBe('cluster');
    expect(draft.rpe).toBe(9);
  });

  it('renders the existing bottom sheet and UI Kit weight/reps picker trigger', () => {
    render(<SetEntry mode="workout" isOpen data={baseData} onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    expect(screen.getByRole('dialog', { name: 'Подход 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' })).toBeTruthy();
    expect(screen.getByText('План: 80 кг')).toBeTruthy();
    expect(screen.getByText('Пред.: 77,5 кг')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Тип подхода' })).toBeTruthy();
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'RPE' })).toBeTruthy();
    expect(document.querySelector('.set-entry-weight-reps__metric-tile')?.classList.contains('ui-glass-surface--halo-lifted')).toBe(true);
  });

  it('keeps the sheet and weight picker outside card transforms and sheet clipping', async () => {
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    appRoot.className = 'k-ios dark';
    const cardHost = document.createElement('div');
    cardHost.className = 'transformed-card';
    appRoot.appendChild(cardHost);
    document.body.appendChild(appRoot);
    try {
      const onSave = vi.fn(async () => undefined);
      const { unmount } = render(<SetEntry mode="workout" isOpen data={baseData}
        onClose={vi.fn()} onSave={onSave} />, { container: cardHost });
      const sheet = screen.getByRole('dialog', { name: 'Подход 3' });
      const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
      expect(appRoot.contains(sheet)).toBe(true);
      expect(cardHost.contains(sheet)).toBe(false);
      expect(sheet.contains(picker)).toBe(false);
      expect(appRoot.contains(picker)).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
      fireEvent.click(within(picker).getByRole('listbox', { name: 'Повторения' })
        .querySelector<HTMLButtonElement>('button[aria-label="9"]')!);
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        metrics: { weightKg: 80, reps: 9, durationSeconds: null, distanceMeters: null },
      })));
      unmount();
    } finally {
      appRoot.remove();
    }
  });

  it('auto-saves the chosen set type and RPE through the parent FACT callback on close', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={baseData} onClose={onClose} onSave={onSave} />);
    const technique = screen.getByRole('button', { name: 'Кластер' });
    const slider = screen.getByRole('slider', { name: 'RPE' });
    expect(technique.getAttribute('aria-pressed')).toBe('false');
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('10');
    fireEvent.click(technique);
    fireEvent.input(slider, { target: { value: '8' } });
    expect(technique.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('RPE: 8')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      setType: 'cluster', setLabel: null, rpe: 8,
      metrics: { weightKg: null, reps: null, durationSeconds: null, distanceMeters: null },
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('saves only occurrence PLAN without showing FACT-only controls or PREVIOUS', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    render(<SetEntry mode="occurrence-plan" isOpen data={{ ...baseData, setType: null }}
      onClose={vi.fn()} onPlanSave={onPlanSave} />);
    expect(screen.queryByRole('slider', { name: 'RPE' })).toBeNull();
    expect(screen.queryByText(/Пред\.:/)).toBeNull();
    expect(screen.queryByText(/^План:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onPlanSave).toHaveBeenCalledWith({ weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null, setType: 'dropset' }));
  });

  it('accepts a supported new FACT without rounding an unsupported PLAN', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={{ ...baseData,
      plan: { ...baseData.plan!, weightKg: 80.1 },
    }} onClose={onClose} onSave={onSave} />);
    expect(screen.getByText('План: 80,1 кг')).toBeTruthy();
    expect(screen.getByText('Не заполнено')).toBeTruthy();
    expect(screen.getByText(/Значение PLAN недоступно в пикере/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Записать.*как факт/ })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
    const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
    fireEvent.click(within(picker).getByRole('listbox', { name: 'Килограммы' })
      .querySelector<HTMLButtonElement>('button[aria-label="80"]')!);
    // Selecting a valid FACT does not rewrite the immutable PLAN comparison.
    expect(screen.getByText('План: 80,1 кг')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      metrics: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('preserves unsupported existing FACT and disables editing without converting its weight', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={{ ...baseData, fact: {
      metrics: { weightKg: 80.1, reps: 10, durationSeconds: null, distanceMeters: null },
      setLabel: null, rpe: null, comment: null, bands: [],
    } }} onClose={onClose} onSave={onSave} />);
    expect(screen.getByText('Существующее значение FACT не поддерживается текущим пикером')).toBeTruthy();
    const metricButton = screen.getByRole('button', { name: 'Изменить вес и повторения' });
    expect(metricButton.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('10 × 80,1 кг')).toBeTruthy();

    // UI Kit retains its closed popover in the DOM for animation. Its DOM
    // presence is not proof that the picker opened.
    fireEvent.click(metricButton);
    expect(metricButton.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('10 × 80,1 кг')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('records the displayed PLAN values as FACT only after explicit confirmation', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={baseData} onClose={onClose} onSave={onSave} />);
    expect(screen.getByText('Не заполнено')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Записать 10 × 80 кг как факт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      metrics: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('saves PLAN changes through the registered navigation Back action before closing', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    let back: (() => void) | undefined;
    const onNavigationContextChange = vi.fn((context: { onBack?: () => void } | null) => {
      back = context?.onBack;
    });
    render(<SetEntry mode="occurrence-plan" isOpen data={baseData}
      onClose={onClose} onPlanSave={onPlanSave}
      onNavigationContextChange={onNavigationContextChange} />);
    expect(back).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    // Back before the 300ms debounce must still persist the latest value.
    back?.();
    await waitFor(() => expect(onPlanSave).toHaveBeenCalledWith({
      weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null, setType: 'cluster',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not navigate away when saving through Back fails', async () => {
    const onPlanSave = vi.fn(async () => { throw new Error('Нет доступа к хранилищу'); });
    const onClose = vi.fn();
    let back: (() => void) | undefined;
    render(<SetEntry mode="occurrence-plan" isOpen data={baseData}
      onClose={onClose} onPlanSave={onPlanSave}
      onNavigationContextChange={context => { back = context?.onBack; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    back?.();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Нет доступа к хранилищу'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the existing DurationPicker for time tracking instead of legacy number inputs', () => {
    render(<SetEntry mode="workout" isOpen data={{ ...baseData, trackingType: 'time',
      plan: { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: null },
    }} onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    expect(screen.getByRole('button', { name: 'Изменить время' })).toBeTruthy();
    expect(screen.getByText('1 показатель')).toBeTruthy();
    expect(screen.queryByLabelText('Время, минуты')).toBeNull();
    expect(screen.getByRole('slider', { name: 'RPE' })).toBeTruthy();
  });
});
