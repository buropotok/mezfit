// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WeightRepsPicker } from './WeightRepsPicker';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

it('accepts a user preference as controlled mode without changing the UI Kit switch mechanics', () => {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onModeChange = vi.fn();
  const onChange = vi.fn();
  const props = { opened: true, target, value: { reps: 8, weightKg: 77.5 }, onClose: vi.fn(), onChange, onModeChange };
  const view = render(<KonstaProvider theme="ios" dark>
    <div className="k-ios dark"><WeightRepsPicker {...props} mode="wheels" /></div>
  </KonstaProvider>);
  expect(screen.getByRole('listbox', { name: 'Повторения' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Режим' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: 'Режим' }));
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith('numbers');
  expect(onChange).not.toHaveBeenCalled();
  // A controlled picker waits for the parent preference state to change.
  expect(screen.getByRole('listbox', { name: 'Повторения' })).toBeTruthy();

  view.rerender(<KonstaProvider theme="ios" dark>
    <div className="k-ios dark"><WeightRepsPicker {...props} mode="numbers" /></div>
  </KonstaProvider>);
  expect(screen.queryByRole('listbox', { name: 'Повторения' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Режим' }).getAttribute('aria-pressed')).toBe('false');
});
