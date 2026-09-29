// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DatePicker opening performance', () => {
  it('reuses localized formatters when opening an already mounted picker', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat');
    const onChange = vi.fn();
    const onClose = vi.fn();

    const renderPicker = (opened: boolean) => (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened={opened}
            value="2026-09-25"
            onChange={onChange}
            onClose={onClose}
          />
        </div>
      </KonstaProvider>
    );

    const view = render(renderPicker(false));
    const initialFormatterCalls = formatterSpy.mock.calls.length;

    expect(initialFormatterCalls).toBeGreaterThan(0);

    view.rerender(renderPicker(true));

    expect(formatterSpy.mock.calls.length).toBe(initialFormatterCalls);
  });
});
