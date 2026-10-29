// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker } from './TimePicker';

vi.mock('../../telegram', () => ({ triggerTelegramPickerSelectionTick: vi.fn() }));

// RequestAnimationFrame runs on the next frame in WebViews, not synchronously.
// An immediate callback stub leaves the picker's frame-id guard permanently set.
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

function dispatchTouch(element: Element, type: string, y: number, time: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', {
    value: [{ clientY: y }],
  });
  fireEvent(element, event);
}

function renderWheel(value = '08:00') {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <TimePicker opened target={target} value={value} onChange={onChange} onClose={() => {}} />
      </div>
    </KonstaProvider>,
  );
  flushFrames();
  return {
    onChange,
    hours: screen.getByRole('listbox', { name: 'Часы' }),
    minutes: screen.getByRole('listbox', { name: 'Минуты' }),
  };
}

beforeEach(() => {
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  frames.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TimePicker regression: retired cyclic scrolling', () => {
  it('renders finite hours and minutes without duplicate cycles', () => {
    const { hours, minutes } = renderWheel('23:59');
    expect(hours.querySelectorAll('button')).toHaveLength(24);
    expect(minutes.querySelectorAll('button')).toHaveLength(60);
    expect(within(hours).getByRole('option', { name: '23' }).getAttribute('aria-selected')).toBe('true');
    expect(within(minutes).getByRole('option', { name: '59' }).getAttribute('aria-selected')).toBe('true');
  });

  it('does not write scrollTop during momentum, then aligns with its direction', () => {
    const { minutes, onChange } = renderWheel('08:10');
    let top = 10 * 36;
    const writes: Array<{ top: number; behavior: ScrollBehavior }> = [];
    Object.defineProperty(minutes, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = value; },
    });
    Object.defineProperty(minutes, 'scrollTo', {
      configurable: true,
      value: ({ top: next, behavior }: { top: number; behavior: ScrollBehavior }) => {
        writes.push({ top: next, behavior });
        top = next;
      },
    });
    for (const offset of [10.3, 10.8, 11.2]) {
      top = offset * 36;
      fireEvent.scroll(minutes);
      flushFrames();
    }
    expect(writes).toEqual([]);
    fireEvent(minutes, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(writes).toEqual([{ top: 12 * 36, behavior: 'smooth' }]);
    expect(onChange).toHaveBeenLastCalledWith('08:12');
  });

  it('never reverses a decreasing wheel when it aligns a fractional position', () => {
    const { minutes, onChange } = renderWheel('08:30');
    const writes: number[] = [];
    Object.defineProperty(minutes, 'scrollTo', {
      configurable: true,
      value: ({ top }: { top: number }) => { writes.push(top); minutes.scrollTop = top; },
    });
    minutes.scrollTop = 12.3 * 36;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(writes).toEqual([]);
    fireEvent(minutes, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(writes).toEqual([12 * 36]);
    expect(onChange).toHaveBeenLastCalledWith('08:12');
  });

  it('keeps normal tap selection and no longer wraps at the end of the range', () => {
    const { hours, minutes, onChange } = renderWheel('22:58');
    fireEvent.click(within(hours).getByRole('option', { name: '23' }));
    expect(onChange).toHaveBeenLastCalledWith('23:58');
    fireEvent.click(within(minutes).getByRole('option', { name: '59' }));
    expect(onChange).toHaveBeenLastCalledWith('23:59');
    expect(hours.querySelectorAll('button')).toHaveLength(24);
    expect(minutes.querySelectorAll('button')).toHaveLength(60);
  });
});
