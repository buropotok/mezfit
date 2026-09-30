/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function picker(opened: boolean) {
  return (
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
}

describe('DatePicker first-open rendering', () => {
  it('mounts heavy calendar content before starting the first panel animation', () => {
    const view = render(picker(false));
    const dialog = view.container.querySelector<HTMLElement>('[aria-label="Выбор даты"]');

    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('invisible');
    expect(view.container.querySelector('[data-month-index="0"]')).toBeNull();
    expect(view.container.querySelector('[data-year="1950"]')).toBeNull();

    view.rerender(picker(true));

    expect(view.container.querySelector('[data-month-index="0"]')).not.toBeNull();
    expect(view.container.querySelector('[data-year="1950"]')).toBeNull();
    expect(dialog?.className).toContain('invisible');
    expect(frames.length).toBeGreaterThan(0);

    const openFrame = frames.shift();
    if (!openFrame) throw new Error('Missing staged DatePicker opening frame');
    act(() => openFrame(0));

    expect(dialog?.className).not.toContain('invisible');
  });

  it('mounts the year grid before starting the first popover animation', () => {
    const view = render(picker(true));
    const panelOpenFrame = frames.shift();
    if (!panelOpenFrame) throw new Error('Missing staged DatePicker opening frame');
    act(() => panelOpenFrame(0));

    frames = [];
    const yearTrigger = view.container.querySelector<HTMLButtonElement>('[aria-label="Выбрать год, сейчас 2026"]');
    if (!yearTrigger) throw new Error('Missing year trigger');

    fireEvent.click(yearTrigger);

    const yearDialog = view.container.querySelector<HTMLElement>('[aria-label="Выберите год"]');
    expect(yearDialog).toBeTruthy();
    expect(view.container.querySelector('[data-year="1950"]')).not.toBeNull();
    expect(yearDialog?.className).toContain('scale-0');
    expect(frames.length).toBeGreaterThan(0);

    const popoverOpenFrame = frames.shift();
    if (!popoverOpenFrame) throw new Error('Missing staged year popover opening frame');
    act(() => popoverOpenFrame(0));

    expect(yearDialog?.className).not.toContain('scale-0');
  });
});
