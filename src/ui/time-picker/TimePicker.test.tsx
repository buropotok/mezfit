// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker, type LocalTime } from './TimePicker';

function renderPicker({
  value = '08:15',
  onChange = vi.fn(),
  onClose = vi.fn(),
}: {
  value?: LocalTime;
  onChange?: (value: LocalTime) => void;
  onClose?: () => void;
} = {}) {
  const target = document.createElement('button');
  document.body.append(target);

  return {
    onChange,
    onClose,
    ...render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <TimePicker
            opened
            target={target}
            value={value}
            onChange={onChange}
            onClose={onClose}
          />
        </div>
      </KonstaProvider>,
    ),
  };
}

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

describe('TimePicker', () => {
  it('renders independent hour and minute scroll ribbons with the controlled value selected', () => {
    renderPicker();

    const hours = screen.getByRole('listbox', { name: 'Часы' });
    const minutes = screen.getByRole('listbox', { name: 'Минуты' });

    expect(within(hours).getByRole('option', { name: '08' }).getAttribute('aria-selected')).toBe('true');
    expect(within(minutes).getByRole('option', { name: '15' }).getAttribute('aria-selected')).toBe('true');
  });

  it('commits an HH:mm value when a wheel option is tapped', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Часы' })).getByRole('option', { name: '10' }));
    expect(onChange).toHaveBeenLastCalledWith('10:15');

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Минуты' })).getByRole('option', { name: '45' }));
    expect(onChange).toHaveBeenLastCalledWith('10:45');
  });

  it('rejects malformed local-time values instead of guessing a timezone-bearing time', () => {
    expect(() => renderPicker({ value: '8:15' })).toThrow(
      'TimePicker value must be a valid HH:mm local time',
    );
  });
});
