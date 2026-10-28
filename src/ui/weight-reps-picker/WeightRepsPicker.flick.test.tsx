// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { DurationPicker } from '../duration-picker/DurationPicker';
import { WeightRepsPicker } from './WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

const ROW_HEIGHT = 48;

function gesture(element: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', y: number, at: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: at });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientY: y }] });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientY: y }] });
  fireEvent(element, event);
}

function mountWeight(initialKg = 280.5) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  function Controlled() {
    const [value, setValue] = useState({ reps: 8, weightKg: initialKg });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker
            opened target={target} value={value}
            onChange={next => { onChange(next); setValue(next); }}
            onClose={vi.fn()}
          />
        </div>
      </KonstaProvider>
    );
  }
  render(<Controlled />);
  return { onChange };
}

beforeEach(() => {
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
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
  document.body.innerHTML = '';
});

describe('WeightRepsPicker 10kg native flick snapping', () => {
  it('activates only after TimePicker-fast gesture and marks every tenth kilogram as a snap stop', () => {
    mountWeight();
    const kilograms = screen.getByRole('listbox', { name: 'Килограммы' });
    gesture(kilograms, 'touchstart', 200, 100);
    gesture(kilograms, 'touchmove', 152, 180);
    expect(kilograms.className).toContain('ui-time-picker__column--flick-snap');
    gesture(kilograms, 'touchend', 128, 230);
    expect(kilograms.className).toContain('ui-time-picker__column--flick-snap');

    for (const kilogram of [0, 10, 280, 290, 300, 390]) {
      expect(within(kilograms).getByRole('option', { name: String(kilogram) }).className)
        .toContain('ui-time-picker__option--flick-stop');
    }
    for (const kilogram of [1, 281, 299, 301, 399]) {
      expect(within(kilograms).getByRole('option', { name: String(kilogram) }).className)
        .not.toContain('ui-time-picker__option--flick-stop');
    }
    expect(screen.getByRole('listbox', { name: 'Повторения' }).className)
      .not.toContain('ui-time-picker__column--flick-snap');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' }).className)
      .not.toContain('ui-time-picker__column--flick-snap');
  });

  it('retains 1kg precision for slow swipes and direct row selection', () => {
    const { onChange } = mountWeight(280.25);
    const kilograms = screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement;
    gesture(kilograms, 'touchstart', 200, 100);
    gesture(kilograms, 'touchmove', 160, 400);
    gesture(kilograms, 'touchend', 154, 800);
    expect(kilograms.className).not.toContain('ui-time-picker__column--flick-snap');

    act(() => { kilograms.scrollTop = 281 * ROW_HEIGHT; fireEvent.scroll(kilograms); });
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    fireEvent.click(within(kilograms).getByRole('option', { name: '283' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 283.25 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(3);
    expect(kilograms.className).not.toContain('ui-time-picker__column--flick-snap');
  });

  it('preserves each crossed-value haptic and intermediate values while fast flick is active', () => {
    const { onChange } = mountWeight();
    const kilograms = screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement;
    gesture(kilograms, 'touchstart', 200, 100);
    gesture(kilograms, 'touchmove', 148, 200);
    gesture(kilograms, 'touchend', 120, 260);
    act(() => { kilograms.scrollTop = 299 * ROW_HEIGHT; fireEvent.scroll(kilograms); });
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 299.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(19);
    act(() => { kilograms.scrollTop = 300 * ROW_HEIGHT; fireEvent.scroll(kilograms); });
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 300.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(20);
  });

  it('keeps TimePicker-style native snapping isolated to kilograms, not DurationPicker', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DurationPicker opened value={125} target={target} onChange={vi.fn()} onClose={vi.fn()} />
        </div>
      </KonstaProvider>,
    );
    const minutes = screen.getByRole('listbox', { name: 'Минуты продолжительности' });
    gesture(minutes, 'touchstart', 200, 100);
    gesture(minutes, 'touchmove', 150, 200);
    gesture(minutes, 'touchend', 125, 240);
    expect(minutes.className).not.toContain('ui-time-picker__column--flick-snap');
  });
});
