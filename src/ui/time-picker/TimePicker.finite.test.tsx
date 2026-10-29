// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker } from './TimePicker';

const ROW_HEIGHT = 36;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
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
    hours: screen.getByRole('listbox', { name: 'Часы' }) as HTMLDivElement,
    minutes: screen.getByRole('listbox', { name: 'Минуты' }) as HTMLDivElement,
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('finite TimePicker wheels', () => {
  it('renders exactly one cycle of 00–23 hours and 00–59 minutes', () => {
    const { hours, minutes } = renderWheel('23:59');
    expect(within(hours).getAllByRole('option')).toHaveLength(24);
    expect(within(minutes).getAllByRole('option')).toHaveLength(60);
    expect(hours.querySelectorAll('button')).toHaveLength(24);
    expect(minutes.querySelectorAll('button')).toHaveLength(60);
    expect(within(hours).getByRole('option', { name: '23' }).getAttribute('aria-selected')).toBe('true');
    expect(within(minutes).getByRole('option', { name: '59' }).getAttribute('aria-selected')).toBe('true');
  });

  it('does not wrap values beyond the beginning or end', () => {
    const { hours, minutes, onChange } = renderWheel('08:30');
    hours.scrollTop = 23 * ROW_HEIGHT;
    fireEvent.scroll(hours);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('23:30');
    minutes.scrollTop = 59 * ROW_HEIGHT;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('23:59');
    hours.scrollTop = 0;
    fireEvent.scroll(hours);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('00:59');
  });

  it('keeps precise minute selection while native scrolling continues', () => {
    const { minutes, onChange } = renderWheel('08:01');
    for (const minute of [10, 32, 53]) {
      minutes.scrollTop = minute * ROW_HEIGHT;
      fireEvent.scroll(minutes);
      flushFrames();
      expect(onChange).toHaveBeenLastCalledWith(`08:${minute}`);
      expect(minutes.scrollTop).toBe(minute * ROW_HEIGHT);
    }
  });

  it('preserves the last native value when dismissed before the next frame', () => {
    const { minutes, onChange } = renderWheel();
    minutes.scrollTop = 37 * ROW_HEIGHT;
    fireEvent.scroll(minutes);
    const dialog = screen.getByRole('dialog', { name: 'Выбор времени' });
    fireEvent.click(dialog.previousElementSibling as Element);
    expect(onChange).toHaveBeenLastCalledWith('08:37');
  });
});
