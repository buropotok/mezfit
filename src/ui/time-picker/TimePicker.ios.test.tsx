// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker } from './TimePicker';

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TimePicker iOS lens mode', () => {
  it('uses scale magnification without displacement filters', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);

    const { container } = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <TimePicker
            opened
            lensMode="ios"
            target={target}
            value="08:15"
            onChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </KonstaProvider>,
    );

    const lens = container.ownerDocument.querySelector('[data-ui-time-picker-lens-mode="ios"]');
    expect(lens).not.toBeNull();
    expect(lens?.querySelector('filter')).toBeNull();

    const selectedHour = Array.from(lens?.querySelectorAll('text') ?? [])
      .find((node) => node.textContent === '08');
    const selectedMinute = Array.from(lens?.querySelectorAll('text') ?? [])
      .find((node) => node.textContent === '15');

    expect(selectedHour?.getAttribute('transform')).toContain('scale(1.55)');
    expect(selectedMinute?.getAttribute('transform')).toContain('scale(1.55)');
  });
});
