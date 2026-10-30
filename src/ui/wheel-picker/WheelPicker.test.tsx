// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WheelPicker } from './WheelPicker';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const values = Array.from({ length: 21 }, (_, index) => index);
const columns = {
  first: { ariaLabel: 'Первое', values, format: String },
  second: { ariaLabel: 'Второе', values, format: String },
  third: { ariaLabel: 'Третье', values, format: String },
};
function flush() {
  const work = [...frames.values()];
  frames.clear();
  act(() => work.forEach(callback => callback(0)));
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame; frames.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup(); frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('shared wheel mechanics across column counts', () => {
  it.each([1, 2, 3] as const)('uses the same cylinder and nearest settle for %i columns', columnCount => {
    const onChange = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <WheelPicker opened columnCount={columnCount} target={document.body}
        value={{ first: 10, second: 10, third: 10 }} columns={columns}
        lensXs={columnCount === 1 ? [144, 0, 0] : columnCount === 2 ? [62, 226, 0] : [48, 144, 240]}
        ariaLabel="Колесо" onChange={onChange} onClose={vi.fn()} />
    </KonstaProvider>);
    flush();
    expect(screen.getAllByRole('listbox')).toHaveLength(columnCount);
    const dialog = screen.getByRole('dialog', { name: 'Колесо' });
    expect(dialog.querySelector('.ui-time-picker__cylinder')).not.toBeNull();
    expect(dialog.style.top).toBe('100px');
    const column = screen.getAllByRole('listbox')[0];
    let top = 10 * 36;
    const writes: Array<{ top: number; behavior: ScrollBehavior }> = [];
    Object.defineProperty(column, 'scrollTop', {
      configurable: true, get: () => top, set: (next: number) => { top = next; },
    });
    Object.defineProperty(column, 'scrollTo', {
      configurable: true, value: (next: { top: number; behavior: ScrollBehavior }) => {
        writes.push(next); top = next.top;
      },
    });
    top = 11.8 * 36;
    fireEvent.scroll(column); flush();
    expect(writes).toEqual([]);
    fireEvent(column, new Event('scrollend', { bubbles: true })); flush();
    expect(writes).toEqual([{ top: 12 * 36, behavior: 'smooth' }]);
    expect(onChange).toHaveBeenLastCalledWith({ first: 12, second: 10, third: 10 });
  });
});
