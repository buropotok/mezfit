// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
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
    expect(screen.getByText('План: 80 кг × 10')).toBeTruthy();
    expect(screen.getByText('Пред.: 77,5 кг × 10')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Тип подхода' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'RPE' })).toBeTruthy();
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
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={baseData} onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    const technique = screen.getByRole('button', { name: 'Кластер' });
    const exertion = screen.getByRole<HTMLInputElement>('slider', { name: 'RPE' });
    expect(technique.getAttribute('aria-pressed')).toBe('false');
    expect(exertion.value).toBe('0');
    fireEvent.click(technique);
    fireEvent.input(exertion, { target: { value: '8' } });
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

  it('saves cloud PLAN without showing FACT-only controls or PREVIOUS', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    render(<SetEntry mode="occurrence-plan" isOpen data={{ ...baseData, setType: null }}
      onClose={vi.fn()} onPlanSave={onPlanSave} />);
    expect(screen.queryByRole('group', { name: 'RPE' })).toBeNull();
    expect(screen.queryByText(/Пред\.:/)).toBeNull();
    expect(screen.queryByText(/^План:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onPlanSave).toHaveBeenCalledWith({ weightKg: 80, reps: 10, setType: 'dropset' }));
  });

  it('supports 80,75 kg in a scheduled PLAN without rounding', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    render(<SetEntry mode="occurrence-plan" isOpen data={{
      ...baseData, plan: { ...baseData.plan!, weightKg: 80.75 },
    }} onClose={vi.fn()} onPlanSave={onPlanSave} />);
    expect(screen.getByText('80,75 кг × 10')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Изменить вес и повторения' });
    expect(trigger.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Повторения и вес' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(onPlanSave).not.toHaveBeenCalled();
  });

  it('opens existing 80,75 kg FACT and retains its RPE unchanged', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={{ ...baseData, fact: {
      metrics: { weightKg: 80.75, reps: 10, durationSeconds: null, distanceMeters: null },
      setLabel: null, rpe: 7, comment: null, bands: [],
    } }} onClose={onClose} onSave={onSave} />);
    expect(screen.getByText('80,75 кг × 10')).toBeTruthy();
    expect(screen.getByText('RPE: 7')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Изменить вес и повторения' });
    expect(trigger.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Повторения и вес' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Записать 80 кг × 10 как факт' }));
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
      weightKg: 80, reps: 10, setType: 'cluster',
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

  it('uses the existing DurationPicker and Mezfit RPE slider for time-based FACT', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{ ...baseData, trackingType: 'time',
        plan: { weightKg: null, reps: null, durationSeconds: 125, distanceMeters: null },
      }} onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    expect(screen.getByRole('button', { name: 'Изменить продолжительность' })).toBeTruthy();
    expect(screen.getByText('План: 00:02:05')).toBeTruthy();
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    fireEvent.input(screen.getByRole<HTMLInputElement>('slider', { name: 'RPE' }),
      { target: { value: '7' } });
    expect(screen.getByText('RPE: 7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      rpe: 7, metrics: { weightKg: null, reps: null, durationSeconds: null, distanceMeters: null },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
