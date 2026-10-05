/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DatePicker } from './DatePicker';

afterEach(() => {
  cleanup();
});

describe('DatePicker closed lifecycle', () => {
  it('keeps the default bare surface mounted and hidden while closed', () => {
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

    expect(view.container.querySelector('.ui-date-picker__prewarm')).toBeNull();

    const surface = view.container.querySelector<HTMLElement>('[data-date-picker-surface="bare"]');
    expect(surface).toBeTruthy();
    expect(surface?.classList.contains('invisible')).toBe(true);
    expect(surface?.classList.contains('ui-date-picker__bare-surface--opened')).toBe(false);
  });
});
