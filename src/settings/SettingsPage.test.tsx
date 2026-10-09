// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsPage glass settings', () => {
  it('opens glass settings and emits preset, blur and optics changes', () => {
    const onGlassSettingsChange = vi.fn();
    const onNavigationContextChange = vi.fn();

    render(
      <SettingsPage
        glassSettings={{ preset: 'frosted', optics: false, blur: 14 }}
        onGlassSettingsChange={onGlassSettingsChange}
        onNavigationContextChange={onNavigationContextChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Настройки стекла' }));

    expect(screen.getByRole('region', { name: 'Настройки стекла' })).toBeTruthy();
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Настройки стекла' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'frosted' }));
    expect(screen.getByText('bezelOnly')).toBeTruthy();
    fireEvent.click(screen.getByText('clear'));

    expect(onGlassSettingsChange).toHaveBeenLastCalledWith({
      preset: 'clear',
      optics: false,
      blur: 2,
    });

    fireEvent.change(screen.getByRole('slider', { name: /Blur/ }), { target: { value: '18' } });

    expect(onGlassSettingsChange).toHaveBeenLastCalledWith({
      preset: 'frosted',
      optics: false,
      blur: 18,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Optics/ }));

    expect(onGlassSettingsChange).toHaveBeenLastCalledWith({
      preset: 'frosted',
      optics: true,
      blur: 14,
    });
  });
});

describe('SettingsPage modules gallery', () => {
  it('opens the modules gallery and exposes real workout modules', () => {
    const onNavigationContextChange = vi.fn();
    render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Собранные модули')).toBeTruthy();
    const sessionExerciseModule = screen.getByRole('region', { name: /^Карточка упражнения и подходов$/ });
    expect(within(sessionExerciseModule).getByText('Жим штанги лёжа')).toBeTruthy();
    expect(within(sessionExerciseModule).getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Модули' }));
  });

  it('shows the active program workout-card capability matrix', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    const workoutCardModule = screen.getByRole('region', { name: 'Карточка тренировки' });
    expect(within(workoutCardModule).getByRole('button', { name: 'Добавить упражнение' })).toBeTruthy();
    expect(within(workoutCardModule).getByRole('button', { name: 'Добавить подход' })).toBeTruthy();

    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Меню тренировки' }));
    const menu = screen.getByRole('menu', { name: 'Меню тренировки' });

    expect(within(menu).getByText('Передать тренировку')).toBeTruthy();
    expect(within(menu).getByText('История')).toBeTruthy();
    expect(within(menu).getByText('Поделиться')).toBeTruthy();
    expect(within(menu).getByText('Комментарий')).toBeTruthy();
    expect(within(menu).queryByText('Изменить название')).toBeNull();
    expect(within(menu).queryByText('Редактировать результаты')).toBeNull();
  });

  it('shows rename only for an active own workout', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    const workoutCardModule = screen.getByRole('region', { name: 'Карточка тренировки' });
    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Active · Own' }));

    expect(within(workoutCardModule).getByText('Без программы')).toBeTruthy();
    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Меню тренировки' }));
    const menu = screen.getByRole('menu', { name: 'Меню тренировки' });

    expect(within(menu).getByText('Изменить название')).toBeTruthy();
    expect(within(menu).getByText('Передать тренировку')).toBeTruthy();
    expect(within(menu).queryByText('Редактировать результаты')).toBeNull();
  });

  it('preserves an own-workout identity across complete and resume in the module demo', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    const workoutCardModule = screen.getByRole('region', { name: 'Карточка тренировки' });
    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Active · Own' }));
    expect(within(workoutCardModule).getByText('Без программы')).toBeTruthy();

    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Завершить тренировку' }));
    expect(within(workoutCardModule).getByText('Без программы')).toBeTruthy();

    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Возобновить тренировку' }));
    expect(within(workoutCardModule).getByText('Без программы')).toBeTruthy();
    expect(within(workoutCardModule).getByRole('button', { name: 'Добавить упражнение' })).toBeTruthy();
  });

  it('keeps a completed workout read-only while exposing completed actions', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    const workoutCardModule = screen.getByRole('region', { name: 'Карточка тренировки' });
    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Completed' }));

    expect(within(workoutCardModule).queryByRole('button', { name: 'Добавить упражнение' })).toBeNull();
    expect(within(workoutCardModule).queryByRole('button', { name: 'Добавить подход' })).toBeNull();
    expect(within(workoutCardModule).queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
    expect(within(workoutCardModule).getByRole('button', { name: 'Комментарий' })).toBeTruthy();

    fireEvent.click(within(workoutCardModule).getByRole('button', { name: 'Меню тренировки' }));
    const menu = screen.getByRole('menu', { name: 'Меню тренировки' });

    expect(within(menu).getByText('Редактировать результаты')).toBeTruthy();
    expect(within(menu).getByText('История')).toBeTruthy();
    expect(within(menu).getByText('Поделиться')).toBeTruthy();
    expect(within(menu).getByText('Комментарий')).toBeTruthy();
    expect(within(menu).queryByText('Передать тренировку')).toBeNull();
    expect(within(menu).queryByText('Изменить название')).toBeNull();
  });

  it('compares the original SVG and iOS Canvas LiquidPopover in Modules', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByRole('region', { name: 'Liquid Popover — сравнение режимов' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть SVG Popover' }));
    expect(screen.getByRole('menu', { name: 'SVG Popover' }).querySelector('canvas')?.style.clipPath)
      .toMatch(/^url\(/);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть Canvas Popover' }));
    expect(screen.getByRole('menu', { name: 'Canvas Popover' }).querySelector('canvas')?.style.clipPath)
      .toBe('none');
  });

  it('mounts the real TimePicker in the modules stand', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Time picker')).toBeTruthy();
    expect(screen.getByText(/Выбранное время: 08:30/)).toBeTruthy();
    expect(screen.getByText(/Haptic backend: none/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Selection' }));
    expect(screen.getByText(/Probe: telegram-selection → unsupported/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать время' }));

    expect(screen.getByRole('dialog', { name: 'Выбор времени' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Часы' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Минуты' })).toBeTruthy();
  });
});
