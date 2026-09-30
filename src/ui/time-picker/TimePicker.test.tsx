// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { TimePicker, type LocalTime } from './TimePicker';

vi.mock('../../telegram', () => ({
  triggerTelegramSelectionHaptic: vi.fn(),
}));

const selectionHapticMock = vi.mocked(triggerTelegramSelectionHaptic);

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
  document.body.appendChild(target);

  const renderResult = render(
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
  );

  return {
    onChange,
    onClose,
    ...renderResult,
    setValue(nextValue: LocalTime) {
      renderResult.rerender(
        <KonstaProvider theme="ios" dark>
          <div className="k-ios dark">
            <TimePicker
              opened
              target={target}
              value={nextValue}
              onChange={onChange}
              onClose={onClose}
            />
          </div>
        </KonstaProvider>,
      );
    },
  };
}

beforeEach(() => {
  selectionHapticMock.mockClear();
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

  it('commits an HH:mm value when a controlled parent accepts each wheel change', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ onChange });

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Часы' })).getByRole('option', { name: '10' }));
    expect(onChange).toHaveBeenLastCalledWith('10:15');

    picker.setValue('10:15');
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Минуты' })).getByRole('option', { name: '45' }));
    expect(onChange).toHaveBeenLastCalledWith('10:45');
  });

  it('emits one Telegram selection haptic for each newly selected wheel value', () => {
    const picker = renderPicker();

    const hours = screen.getByRole('listbox', { name: 'Часы' });
    fireEvent.click(within(hours).getByRole('option', { name: '10' }));
    expect(selectionHapticMock).toHaveBeenCalledTimes(1);

    picker.setValue('10:15');
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Часы' })).getByRole('option', { name: '10' }));
    expect(selectionHapticMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Минуты' })).getByRole('option', { name: '45' }));
    expect(selectionHapticMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed local-time values instead of guessing a timezone-bearing time', () => {
    expect(() => renderPicker({ value: '8:15' })).toThrow(
      'TimePicker value must be a valid HH:mm local time',
    );
  });
});
