// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic, triggerTelegramPickerSelectionTick } from '../../telegram';
import { WeightRepsPicker } from '../weight-reps-picker/WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn(), triggerTelegramPickerSelectionTick: vi.fn() }));

const ROW_HEIGHT = 48;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function flushFrame(timestamp = 0) {
  const work = [...frames.values()];
  frames.clear();
  act(() => work.forEach(callback => callback(timestamp)));
}

function mountControlled(accepts = true) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  function Picker() {
    const [value, setValue] = useState({ reps: 8, weightKg: 77.5 });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened value={value} target={target}
            onChange={(next) => { onChange(next); if (accepts) setValue(next); }}
            onClose={vi.fn()} />
        </div>
      </KonstaProvider>
    );
  }
  render(<Picker />);
  flushFrame();
  return { onChange };
}

function observeNativeFractions(index: number) {
  const element = screen.getByRole('listbox', { name: 'Доли килограмма' }) as HTMLDivElement;
  let position = index * ROW_HEIGHT;
  const appWrites: number[] = [];
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => position,
    set: (next: number) => { appWrites.push(next); position = next; },
  });
  Object.defineProperty(element, 'scrollTo', {
    configurable: true,
    value: ({ top }: { top: number }) => { element.scrollTop = top; },
  });
  return {
    element, appWrites,
    moveTo(nextIndex: number) {
      position = nextIndex * ROW_HEIGHT;
      fireEvent.scroll(element);
    },
  };
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.mocked(triggerTelegramPickerSelectionTick).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function closePicker() {
  const dialog = screen.getByRole('dialog', { name: 'Повторения и вес' });
  fireEvent.click(dialog.previousElementSibling as Element);
}

describe('three-column static lens slots preserve the native fraction wheel', () => {
  it('removes repetition and integer weight listboxes, leaving one native wheel', () => {
    mountControlled();
    expect(screen.queryByRole('listbox', { name: 'Повторения' })).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Килограммы' })).toBeNull();
    const fractions = screen.getByRole('listbox', { name: 'Доли килограмма' });
    expect(within(fractions).getAllByRole('option')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Изменить повторения' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить целые килограммы' })).toBeTruthy();
  });

  it('retains native fraction scrolling without Telegram haptics', () => {
    const { onChange } = mountControlled();
    const wheel = observeNativeFractions(2);
    act(() => wheel.moveTo(3));
    flushFrame();
    expect(onChange).not.toHaveBeenCalled();
    expect(triggerTelegramSelectionHaptic).not.toHaveBeenCalled();
    expect(wheel.appWrites).toEqual([]);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.75 });
  });

  it('retains the local fraction draft after the 200ms fallback in legacy WebViews', () => {
    const { onChange } = mountControlled(false);
    const wheel = observeNativeFractions(2);
    Object.defineProperty(wheel.element, 'onscrollend', { configurable: true, value: undefined });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => wheel.moveTo(3));
    flushFrame();
    expect(onChange).not.toHaveBeenCalled();
    expect(wheel.appWrites).toEqual([]);
    act(() => vi.advanceTimersByTime(199));
    expect(wheel.appWrites).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    flushFrame();
    expect(wheel.appWrites).toEqual([]);
    expect(wheel.element.scrollTop).toBe(3 * ROW_HEIGHT);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.75 });
  });

  it('retains the local fraction draft after scrollend on modern WebViews', () => {
    const { onChange } = mountControlled(false);
    const wheel = observeNativeFractions(2);
    Object.defineProperty(wheel.element, 'onscrollend', { configurable: true, value: null });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => wheel.moveTo(3));
    flushFrame();
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(wheel.appWrites).toEqual([]);
    fireEvent(wheel.element, new Event('scrollend', { bubbles: true }));
    flushFrame();
    expect(wheel.appWrites).toEqual([]);
    expect(wheel.element.scrollTop).toBe(3 * ROW_HEIGHT);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.75 });
  });

  it('keeps direct fraction taps independent of the numeric sheet actions', () => {
    const { onChange } = mountControlled();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getByRole('option', { name: '0,25' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(triggerTelegramSelectionHaptic).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.25 });
  });
});

function mountCompact() {
  const result = mountControlled();
  fireEvent.click(screen.getByRole('button', { name: 'Режим' }));
  flushFrame();
  return result;
}

function trackWheel(label: string, initialRow: number) {
  const element = screen.getByRole('listbox', { name: label }) as HTMLDivElement;
  let top = initialRow * 36;
  const writes: Array<{ top: number; behavior: ScrollBehavior }> = [];
  Object.defineProperty(element, 'scrollTop', {
    configurable: true, get: () => top, set: (next: number) => { top = next; },
  });
  Object.defineProperty(element, 'scrollTo', {
    configurable: true,
    value: (next: { top: number; behavior: ScrollBehavior }) => { writes.push(next); top = next.top; },
  });
  return {
    element, writes,
    move(row: number) { top = row * 36; fireEvent.scroll(element); },
  };
}

function touchWheel(element: Element, type: string, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, type === 'touchend' || type === 'touchcancel' ? 'changedTouches' : 'touches', {
    value: [{ clientY: y }],
  });
  fireEvent(element, event);
}

describe('weight/reps wheels use TimePicker native momentum and compact optics', () => {
  it('uses the same compact capsule and compensates SVG glyphs at all three centers', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    mountCompact();
    const dialog = screen.getByRole('dialog', { name: 'Повторения и вес' });
    expect(dialog.style.width).toBe('270px');
    expect(dialog.classList.contains('ui-time-picker__popover--compact-time')).toBe(true);
    expect(dialog.style.top).toBe('100px');
    expect(screen.getAllByRole('listbox')).toHaveLength(3);
    const texts = Array.from(dialog.querySelectorAll('.ui-time-picker__lens-text'));
    for (const x of ['80', '176', '240']) {
      const column = texts.filter(text => text.getAttribute('x') === x);
      expect(column.map(text => text.getAttribute('y'))).toEqual(['-36', '36', '108']);
      expect(column[1].getAttribute('transform')).toContain('scale(1.55 3.1)');
    }
    expect(dialog.querySelector('.ui-time-picker__lens-separator')?.getAttribute('transform'))
      .toContain('scale(1.55 3.1)');
  });

  it.each([
    { label: 'Повторения', origin: 8, landing: 9.2, aligned: 9, result: { reps: 9, weightKg: 77.5 } },
    { label: 'Килограммы', origin: 77, landing: 78.2, aligned: 78, result: { reps: 8, weightKg: 78.5 } },
    { label: 'Доли килограмма', origin: 2, landing: 2.8, aligned: 3, result: { reps: 8, weightKg: 77.75 } },
  ])('leaves $label free during inertia and settles to the nearest center only after scrollend', ({ label, origin, landing, aligned, result }) => {
    const { onChange } = mountCompact();
    const wheel = trackWheel(label, origin);
    wheel.move(landing);
    flushFrame();
    expect(wheel.writes).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(wheel.element, new Event('scrollend', { bubbles: true }));
    flushFrame();
    expect(wheel.writes).toEqual([{ top: aligned * 36, behavior: 'smooth' }]);
    expect(onChange).not.toHaveBeenCalled();
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(result);
  });

  it('selects the nearest center even when it is behind the flick direction', () => {
    mountCompact();
    const wheel = trackWheel('Килограммы', 77);
    touchWheel(wheel.element, 'touchstart', 220);
    touchWheel(wheel.element, 'touchend', 100);
    wheel.move(78.2);
    flushFrame();
    wheel.move(78.15);
    flushFrame();
    expect(wheel.writes).toEqual([]);
    fireEvent(wheel.element, new Event('scrollend', { bubbles: true }));
    expect(wheel.writes).toEqual([{ top: 78 * 36, behavior: 'smooth' }]);
  });

  it('settles decreasing motion to the nearer higher cell', () => {
    mountCompact();
    const wheel = trackWheel('Килограммы', 77);
    wheel.move(72.8);
    flushFrame();
    fireEvent(wheel.element, new Event('scrollend', { bubbles: true }));
    expect(wheel.writes).toEqual([{ top: 73 * 36, behavior: 'smooth' }]);
  });

  it('uses the same selection tick at observed crossings without bursts for skipped frames', () => {
    mountCompact();
    const wheel = trackWheel('Килограммы', 77);
    wheel.move(78);
    flushFrame();
    wheel.move(95);
    flushFrame();
    wheel.move(95.1);
    flushFrame();
    expect(triggerTelegramPickerSelectionTick).toHaveBeenCalledTimes(2);
    expect(triggerTelegramSelectionHaptic).not.toHaveBeenCalled();
  });

  it('ignores a synthetic option click after a flick instead of interrupting inertia', () => {
    const { onChange } = mountCompact();
    const wheel = trackWheel('Повторения', 8);
    touchWheel(wheel.element, 'touchstart', 220);
    touchWheel(wheel.element, 'touchmove', 100);
    touchWheel(wheel.element, 'touchcancel', 100);
    wheel.move(12);
    flushFrame();
    fireEvent.click(within(wheel.element).getByRole('option', { name: '30' }), { detail: 1 });
    expect(wheel.writes).toEqual([]);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 12, weightKg: 77.5 });
  });

  it('does not interrupt an older WebView at 200ms and waits 450ms after the last scroll event', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mountCompact();
    const wheel = trackWheel('Килограммы', 77);
    Object.defineProperty(wheel.element, 'onscrollend', { configurable: true, value: undefined });
    wheel.move(78.2);
    flushFrame();
    act(() => vi.advanceTimersByTime(200));
    expect(wheel.writes).toEqual([]);
    wheel.move(79.2);
    flushFrame();
    act(() => vi.advanceTimersByTime(449));
    expect(wheel.writes).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(wheel.writes).toEqual([{ top: 79 * 36, behavior: 'smooth' }]);
  });

  it('returns to the numeric layout with both drafts intact', () => {
    const { onChange } = mountCompact();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Повторения' }))
      .getByRole('option', { name: '12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Режим' }));
    expect(screen.getByRole('dialog', { name: 'Повторения и вес' }).style.width).toBe('336px');
    expect(document.querySelector('[data-ui-picker-static-value="first"]')?.textContent).toBe('12');
    expect(onChange).not.toHaveBeenCalled();
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 12, weightKg: 77.5 });
  });
});
