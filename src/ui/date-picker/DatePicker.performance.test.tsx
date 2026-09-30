// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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

describe('DatePicker reopen behavior', () => {
  it('keeps the original selected year when reopened', () => {
    const renderPicker = (opened: boolean) => (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened={opened}
            value="2026-09-25"
            onChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </KonstaProvider>
    );

    const view = render(renderPicker(true));
    expect(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' })).toBeTruthy();

    view.rerender(renderPicker(false));
    view.rerender(renderPicker(true));

    expect(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' })).toBeTruthy();
  });
});
