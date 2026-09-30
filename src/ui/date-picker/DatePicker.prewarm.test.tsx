/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DatePicker } from './DatePicker';

afterEach(() => {
  cleanup();
});

describe('DatePicker closed lifecycle', () => {
  it('does not render a separate prewarm surface and leaves closed Panel visibility to Konsta', () => {
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

    const panel = view.container.querySelector<HTMLElement>('[aria-label="Выбор даты"]');
    expect(panel).toBeTruthy();
    expect(panel?.className).toContain('invisible');
    expect(panel?.style.visibility).toBe('');
  });
});
