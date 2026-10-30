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
    onClose,
    ...renderResult,
    setValue(nextValue: number, opened = true) {
      renderResult.rerender(
        <KonstaProvider theme="ios" dark>
          <div className="k-ios dark">
            <NumPicker
              opened={opened}
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
  it('renders a single finite column containing every integer from 0 through 999', () => {
    renderPicker({ value: 7 });
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    const column = screen.getByRole('listbox', { name: 'Число' });
    expect(within(column).getAllByRole('option')).toHaveLength(1000);
    expect(within(column).getByRole('option', { name: '7' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Выбор числа' }).querySelector('.ui-time-picker__cylinder')).not.toBeNull();
  });

  it('chooses whole numbers and retains controlled updates and finite endpoints', () => {
    const picker = renderPicker({ value: 7 });
    const select = (value: string) => fireEvent.click(within(screen.getByRole('listbox', { name: 'Число' }))
      .getByRole('option', { name: value }));
    select('207');
    expect(picker.onChange).toHaveBeenLastCalledWith(207);
    picker.setValue(207);
    select('242');
    expect(picker.onChange).toHaveBeenLastCalledWith(242);
    picker.setValue(242);
    select('999');
    expect(picker.onChange).toHaveBeenLastCalledWith(999);
    picker.setValue(999);
    vi.mocked(picker.onChange).mockClear();
    select('999');
    expect(picker.onChange).not.toHaveBeenCalled();
    select('0');
    expect(picker.onChange).toHaveBeenLastCalledWith(0);
  });

  it('reopens with the controlled value and closes unchanged without a write', () => {
    const picker = renderPicker({ value: 399 });
    picker.setValue(999, false);
    picker.setValue(999, true);
    const option = within(screen.getByRole('listbox', { name: 'Число' })).getByRole('option', { name: '999' });
    expect(option.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('dialog', { name: 'Выбор числа' }).previousElementSibling as Element);
    expect(picker.onClose).toHaveBeenCalledTimes(1);
    expect(picker.onChange).not.toHaveBeenCalled();
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
