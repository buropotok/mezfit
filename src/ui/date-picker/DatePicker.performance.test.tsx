// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker formatter reuse', () => {
  it('does not construct per-day Intl formatters again on rerender', () => {
    const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat');

    const renderPicker = (opened: boolean) => (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened={opened}
            value="2026-09-25"
            locale="en-AU"
            onChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </KonstaProvider>
    );

    const view = render(renderPicker(false));
    const initialFormatterCalls = formatterSpy.mock.calls.length;

    expect(initialFormatterCalls).toBeGreaterThan(0);
    expect(initialFormatterCalls).toBeLessThan(10);

    view.rerender(renderPicker(true));

    expect(formatterSpy.mock.calls.length).toBe(initialFormatterCalls);
  });
});
