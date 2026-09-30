/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 288,
    bottom: 720,
    width: 288,
    height: 720,
    toJSON: () => ({}),
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker filter prewarm', () => {
  it('prewarms a separate GlassSurface without overriding the closed Panel lifecycle', () => {
    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened={false}
            value="2026-09-25"
            onChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </KonstaProvider>,
    );

    const prewarm = view.container.querySelector<HTMLElement>('.ui-date-picker__prewarm');
    const prewarmGlass = view.container.querySelector<HTMLElement>('.ui-date-picker__prewarm-glass');
    const panel = view.container.querySelector<HTMLElement>('[aria-label="Выбор даты"]');

    expect(prewarm).toBeTruthy();
    expect(prewarm?.getAttribute('aria-hidden')).toBe('true');
    expect(prewarmGlass?.classList.contains('ui-glass-surface')).toBe(true);

    expect(panel).toBeTruthy();
    expect(panel?.className).toContain('invisible');
    expect(panel?.style.visibility).toBe('');
    expect(panel?.hasAttribute('data-ui-glass-prewarm')).toBe(false);
  });
});
