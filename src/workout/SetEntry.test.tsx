// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it.each(['weight_reps', 'time'] as const)('%s ignores late save completion after leaving the editor', async trackingType => {
    let finish = () => {};
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    const view = render(<KonstaProvider theme="ios" dark><SetEntry mode="workout" isOpen data={{ ...baseData, trackingType }} onSave={onSave} onClose={onClose} /></KonstaProvider>);
    fireEvent.input(screen.getByRole('slider', { name: 'RPE' }), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    view.unmount();
    await act(async () => finish());
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(['weight_reps', 'time'] as const)('%s saves once after Yes and waits before closing', async trackingType => {
    let finish = () => {};
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark><SetEntry mode="workout" isOpen data={{ ...baseData, trackingType }} onSave={onSave} onClose={onClose} /></KonstaProvider>);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать' })).toBeNull();
    fireEvent.input(screen.getByRole('slider', { name: 'RPE' }), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const yes = screen.getByRole('button', { name: 'Да' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
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
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');
    expect(screen.getByText('План: 80 кг × 10')).toBeTruthy();
    expect(screen.getByText('Пред.: 77,5 кг × 10')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Тип подхода' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'RPE' })).toBeTruthy();
  });

  it('displays an existing FACT above old numeric limits instead of blocking the picker', () => {
    render(<SetEntry mode="workout" isOpen data={{
      ...baseData,
      fact: {
        metrics: { weightKg: 450.75, reps: 1234, durationSeconds: null, distanceMeters: null },
        setLabel: null, setType: null, rpe: null, comment: null, bands: [],
      },
    }} onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent)
      .toContain('450,75 кг × 1234');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Стереть последнюю цифру' }));
    expect(document.querySelector('[data-ui-picker-static-value="second"]')?.textContent).toBe('45');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' })).toBeTruthy();
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
      expect(appRoot.contains(sheet)).toBe(true);
      expect(cardHost.contains(sheet)).toBe(false);
      // Closed popovers must not expose interactive roles until the user opens them.
      expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
      const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
      expect(sheet.contains(picker)).toBe(false);
      expect(appRoot.contains(picker)).toBe(true);
      fireEvent.click(within(picker).getByRole('button', { name: 'Изменить повторения' }));
      const keypad = screen.getByRole('dialog', { name: 'Ввод повторений' });
      expect(sheet.contains(keypad)).toBe(false);
      expect(cardHost.contains(keypad)).toBe(false);
      expect(appRoot.contains(keypad)).toBe(true);
      fireEvent.click(within(keypad).getByRole('button', { name: 'Цифра 9' }));
      fireEvent.click(within(keypad).getByRole('button', { name: 'Сохранить' }));
      expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent)
        .toContain('80 кг × 9');
      expect(onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
      fireEvent.click(screen.getByRole('button', { name: 'Да' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        metrics: { weightKg: 80, reps: 9, durationSeconds: null, distanceMeters: null },
      })));
      unmount();
    } finally {
      appRoot.remove();
    }
  });

  it('persists chosen type and RPE only after explicitly confirming Yes on close', async () => {
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
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    const save = screen.getByRole('button', { name: 'Да' });
    expect(save.querySelector('.ui-text--body')).not.toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      setType: 'cluster', setLabel: null, rpe: 8,
      metrics: { weightKg: null, reps: null, durationSeconds: null, distanceMeters: null },
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('clears an existing optional weight/reps RPE when slider returns to zero', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{
        ...baseData, fact: {
          metrics: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
          setLabel: null, setType: null, rpe: 8, comment: null, bands: [],
        },
      }} onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    expect(screen.getByText('RPE: 8')).toBeTruthy();
    fireEvent.input(screen.getByRole('slider', { name: 'RPE' }), { target: { value: '0' } });
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      rpe: null, setLabel: null,
      metrics: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
    })));
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
    expect(onPlanSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
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
    expect(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' }).classList.contains('invisible')).toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows empty FACT until opening the plan-valued picker and saves only after picker acceptance', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={baseData} onClose={onClose} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');
    expect(screen.getByText('План: 80 кг × 10')).toBeTruthy();
    expect(screen.getByText('RPE: 0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Записать.*как факт/ })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
    expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('10');
    expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('80');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('80 кг × 10');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      metrics: { weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null },
      rpe: null,
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('discards edited FACT only after No in the save-on-close dialog', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={baseData} onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(screen.getByText('Сохранить изменения?')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not autosave FACT changes even after the previous debounce interval', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={baseData}
        onClose={vi.fn()} onSave={onSave} />
    </KonstaProvider>);
    fireEvent.input(screen.getByRole('slider', { name: 'RPE' }), { target: { value: '8' } });
    await new Promise<void>(resolve => { window.setTimeout(resolve, 750); });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  });

  it('uses the same discard dialog for navigation Back, without saving FACT', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    let back: (() => void) | undefined;
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={baseData}
        onClose={onClose} onSave={onSave}
        onNavigationContextChange={context => { back = context?.onBack; }} />
    </KonstaProvider>);
    expect(back).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    act(() => { back?.(); });
    expect(screen.getByText('Сохранить изменения?')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each(['weight_reps', 'time'] as const)('keeps %s FACT editor open on Yes failure and permits retry', async trackingType => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Сервер недоступен'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{ ...baseData, trackingType }}
        onClose={onClose} onSave={onSave} />
    </KonstaProvider>);
    fireEvent.input(screen.getByRole('slider', { name: 'RPE' }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Сервер недоступен'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('RPE: 7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('never saves scheduled PLAN through Back and confirms discarding changed values', async () => {
    const onPlanSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    let back: (() => void) | undefined;
    render(<SetEntry mode="occurrence-plan" isOpen data={baseData}
      onClose={onClose} onPlanSave={onPlanSave}
      onNavigationContextChange={context => { back = context?.onBack; }} />);
    expect(back).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
    act(() => { back?.(); });
    expect(screen.getByText('Сохранить изменения?')).toBeTruthy();
    expect(onPlanSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onPlanSave).not.toHaveBeenCalled();
  });

  it('does not autosave scheduled PLAN and retries only after explicit Save failure', async () => {
    const onPlanSave = vi.fn().mockRejectedValueOnce(new Error('Нет доступа к хранилищу'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<SetEntry mode="occurrence-plan" isOpen data={baseData}
      onClose={onClose} onPlanSave={onPlanSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    await new Promise<void>(resolve => { window.setTimeout(resolve, 450); });
    expect(onPlanSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Нет доступа к хранилищу'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onPlanSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      rpe: 7, metrics: { weightKg: null, reps: null, durationSeconds: null, distanceMeters: null },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

it.each(['weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight'] as const)(
  '%s closes an unchanged SetEntry without a dialog or writes', trackingType => {
    const save = vi.fn(), close = vi.fn();
    render(<SetEntry mode="workout" isOpen data={{ ...baseData, trackingType }} onClose={close} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' }).classList.contains('invisible')).toBe(true);
  },
);

it('closes without a prompt when metadata changes are reverted to the initial values', () => {
  const close = vi.fn(), save = vi.fn();
  render(<SetEntry mode="workout" isOpen data={baseData} onClose={close} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
  fireEvent.click(screen.getByRole('button', { name: 'Кластер' }));
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' }).classList.contains('invisible')).toBe(true);
});

it.each([false, true])('accepts PLAN as new FACT after saving the numeric form (retyped=%s)', async retyped => {
  const close = vi.fn(), save = vi.fn(async () => undefined);
  render(<SetEntry mode="workout" isOpen data={baseData} onClose={close} onSave={save} />);
  expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');
  fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
  expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('10');
  expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('80');
  fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
  if (retyped) {
    fireEvent.click(screen.getByRole('button', { name: 'Очистить ввод' }));
    fireEvent.click(screen.getByRole('button', { name: 'Цифра 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Цифра 0' }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
  fireEvent.click(screen.getByRole('button', { name: 'Да' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ metrics: baseData.plan })));
});

it('opens the existing FACT as numbers and closes both picker layers on Cancel without changing SetEntry', () => {
  const close = vi.fn(), save = vi.fn();
  const fact = { metrics: { weightKg: 82.75, reps: 12, durationSeconds: null, distanceMeters: null },
    setLabel: null, setType: null, rpe: 7, comment: null, bands: [] };
  render(<SetEntry mode="workout" isOpen data={{ ...baseData, fact }} onClose={close} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
  expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('12');
  expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('82');
  expect(screen.getByRole('button', { name: 'Изменить повторения' }).querySelector('.ui-icon')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
  fireEvent.click(screen.getByRole('button', { name: 'Цифра 9' }));
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('82,75 кг × 12');
  expect(screen.getByRole('dialog', { name: 'Подход 3' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it('records prefilled PLAN after ordinary picker dismissal without edits or numeric Save', async () => {
  const save = vi.fn(async () => undefined);
  render(<KonstaProvider theme="ios" dark>
    <SetEntry mode="workout" isOpen data={baseData} onClose={vi.fn()} onSave={save} />
  </KonstaProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
  const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
  fireEvent.click(picker.previousElementSibling as Element);
  expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('80 кг × 10');
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
  fireEvent.click(screen.getByRole('button', { name: 'Да' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ metrics: baseData.plan })));
});

it('keeps an untouched empty FACT empty after opening and closing the picker', () => {
  const close = vi.fn(), save = vi.fn();
  render(<KonstaProvider theme="ios" dark>
    <SetEntry mode="workout" isOpen data={{ ...baseData, plan: null }} onClose={close} onSave={save} />
  </KonstaProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
  expect(screen.getByRole('button', { name: 'Изменить повторения' }).querySelector('.ui-icon')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Изменить целые килограммы' }).querySelector('.ui-icon')).not.toBeNull();
  const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
  fireEvent.click(picker.previousElementSibling as Element);
  expect(screen.getByRole('button', { name: 'Изменить вес и повторения' }).textContent).toContain('Введите факт');
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it('saves a partial PLAN without replacing its missing weight by zero', async () => {
  const save = vi.fn(async () => undefined);
  const plan = { weightKg: null, reps: 10, durationSeconds: null, distanceMeters: null };
  render(<KonstaProvider theme="ios" dark>
    <SetEntry mode="workout" isOpen data={{ ...baseData, plan }} onClose={vi.fn()} onSave={save} />
  </KonstaProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить вес и повторения' }));
  expect(screen.getByRole('button', { name: 'Изменить целые килограммы' }).querySelector('.ui-icon')).not.toBeNull();
  const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
  fireEvent.click(picker.previousElementSibling as Element);
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
  fireEvent.click(screen.getByRole('button', { name: 'Да' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ metrics: plan })));
});

describe('session FACT objects without measurements', () => {
  const emptyFact: NonNullable<SetEntryData['fact']> = {
    metrics: { weightKg: null, reps: null, durationSeconds: null, distanceMeters: null },
    setLabel: null, setType: 'cluster', rpe: 6, comment: 'Сохранить комментарий', bands: ['red'],
  };

  it('keeps pending FACT empty while preserving its metadata and the independent PLAN', () => {
    const snapshot = structuredClone({ ...baseData, fact: emptyFact });
    const draft = createSetEntryDraft(snapshot);
    expect(draft.metrics).toEqual(emptyFact.metrics);
    expect(draft.metrics).not.toBe(snapshot.fact?.metrics);
    expect(draft).toMatchObject({ setType: 'cluster', rpe: 6,
      comment: 'Сохранить комментарий', bands: ['red'] });
    expect(snapshot.fact).toEqual(emptyFact);
    expect(snapshot.plan).toEqual(baseData.plan);
  });

  it.each([
    { weightKg: 0, reps: 0, durationSeconds: null, distanceMeters: null },
    { weightKg: null, reps: 5, durationSeconds: null, distanceMeters: null },
  ])('preserves recorded zero and partial FACT instead of replacing them with PLAN: %j', metrics => {
    expect(createSetEntryDraft({ ...baseData, fact: { ...emptyFact, metrics } }).metrics).toEqual(metrics);
  });

  it('closes untouched session input without prompting or writing the PLAN as FACT', () => {
    const close = vi.fn(), save = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <SetEntry mode="workout" isOpen data={{ ...baseData, fact: emptyFact }} onClose={close} onSave={save} />
    </KonstaProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть подход' }));
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' }).classList.contains('invisible')).toBe(true);
  });
});
