// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumPicker } from './NumPicker';

function renderPicker({
  value = 7,
  onChange = vi.fn(),
  onClose = vi.fn(),
}: {
  value?: number;
  onChange?: (value: number) => void;
  onClose?: () => void;
} = {}) {
  const target = document.createElement('button');
  document.body.appendChild(target);

  const renderResult = render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <NumPicker
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
    ...renderResult,
    setValue(nextValue: number) {
      renderResult.rerender(
        <KonstaProvider theme="ios" dark>
          <div className="k-ios dark">
            <NumPicker
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

describe('NumPicker', () => {
  it('represents values below 100 with an empty hundreds column', () => {
    renderPicker({ value: 7 });

    const hundreds = screen.getByRole('listbox', { name: 'Сотни' });
    const lower = screen.getByRole('listbox', { name: 'Последние две цифры' });

    expect(within(hundreds).getByRole('option', { name: 'Без сотен' }).getAttribute('aria-selected')).toBe('true');
    expect(within(lower).getByRole('option', { name: '07' }).getAttribute('aria-selected')).toBe('true');
  });

  it('combines hundreds and the last two digits into a controlled number', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ value: 7, onChange });

    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Сотни' })).getByRole('option', { name: '2' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(207);

    picker.setValue(207);
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Последние две цифры' })).getByRole('option', { name: '42' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(242);
  });

  it('selects the complete 0–999 range and emits exactly 999', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ value: 0, onChange });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Сотни' })).getByRole('option', { name: '9' }));
    expect(onChange).toHaveBeenLastCalledWith(900);
    picker.setValue(900);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Последние две цифры' })).getByRole('option', { name: '99' }));
    expect(onChange).toHaveBeenLastCalledWith(999);
    picker.setValue(999);
    expect(within(screen.getByRole('listbox', { name: 'Сотни' })).getByRole('option', { name: '9' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('listbox', { name: 'Последние две цифры' })).getByRole('option', { name: '99' }).getAttribute('aria-selected')).toBe('true');
    onChange.mockClear();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Сотни' })).getByRole('option', { name: '9' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects values outside the supported integer range', () => {
    expect(() => renderPicker({ value: 1000 })).toThrow(
      'NumPicker value must be an integer from 0 to 999',
    );
    expect(() => renderPicker({ value: 12.5 })).toThrow(
      'NumPicker value must be an integer from 0 to 999',
    );
  });
});
