/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassPanel } from './GlassPanel';
import { GlassPopover } from './GlassPopover';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('ui-glass-popover')) {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 284,
        bottom: 376,
        width: 284,
        height: 376,
        toJSON: () => ({}),
      };
    }

    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 288,
      bottom: 640,
      width: 288,
      height: 640,
      toJSON: () => ({}),
    };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('glass overlay primitives', () => {
  it('keeps a closed GlassPanel mounted without activating glass-map work', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    render(
      <GlassPanel opened={false} role="dialog" aria-label="Panel">
        Content
      </GlassPanel>,
    );

    const panel = document.querySelector<HTMLElement>('.ui-glass-panel');
    const surface = panel?.querySelector<HTMLElement>('.ui-glass-surface');

    expect(panel?.dataset.state).toBe('closed');
    expect(surface?.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('keeps panel displacement active until the exit transform finishes', () => {
    const view = render(
      <GlassPanel opened role="dialog" aria-label="Animated panel">
        Content
      </GlassPanel>,
    );

    const getPanel = () => document.querySelector<HTMLElement>('.ui-glass-panel');
    const getSurface = () => getPanel()?.querySelector<HTMLElement>('.ui-glass-surface');

    expect(getSurface()?.dataset.uiGlassActive).toBe('true');

    view.rerender(
      <GlassPanel opened={false} role="dialog" aria-label="Animated panel">
        Content
      </GlassPanel>,
    );

    expect(getPanel()?.dataset.state).toBe('closed');
    expect(getSurface()?.dataset.uiGlassActive).toBe('true');

    const panel = getPanel();
    if (panel) fireEvent.transitionEnd(panel, { propertyName: 'transform' });

    expect(getSurface()?.dataset.uiGlassActive).toBe('false');
  });

  it('keeps popover displacement active until its exit transform finishes', () => {
    const target = document.createElement('button');
    target.getBoundingClientRect = () => ({
      x: 120,
      y: 120,
      left: 120,
      top: 120,
      right: 164,
      bottom: 164,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);

    const view = render(
      <GlassPopover
        opened
        target={target}
        role="dialog"
        aria-label="Animated popover"
      >
        Years
      </GlassPopover>,
    );

    const getPopover = () => screen.getByRole('dialog', { name: 'Animated popover', hidden: true });
    const getSurface = () => getPopover().querySelector<HTMLElement>('.ui-glass-surface');

    expect(getSurface()?.dataset.uiGlassActive).toBe('true');

    view.rerender(
      <GlassPopover
        opened={false}
        target={target}
        role="dialog"
        aria-label="Animated popover"
      >
        Years
      </GlassPopover>,
    );

    expect(getPopover().dataset.state).toBe('closed');
    expect(getPopover().dataset.ready).toBe('true');
    expect(getSurface()?.dataset.uiGlassActive).toBe('true');

    fireEvent.transitionEnd(getPopover(), { propertyName: 'transform' });

    expect(getPopover().dataset.ready).toBe('false');
    expect(getSurface()?.dataset.uiGlassActive).toBe('false');
  });

  it('positions an opened GlassPopover around its target and owns ModalTuned directly', () => {
    const target = document.createElement('button');
    target.getBoundingClientRect = () => ({
      x: 120,
      y: 120,
      left: 120,
      top: 120,
      right: 164,
      bottom: 164,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);

    const onBackdropClick = vi.fn();

    render(
      <GlassPopover
        opened
        target={target}
        onBackdropClick={onBackdropClick}
        style={{ width: '284px' }}
        role="dialog"
        aria-label="Popover"
      >
        Years
      </GlassPopover>,
    );

    const popover = screen.getByRole('dialog', { name: 'Popover' });
    const surface = popover.querySelector<HTMLElement>('.ui-glass-surface');

    expect(popover.dataset.ready).toBe('true');
    expect(popover.style.left).not.toBe('');
    expect(popover.style.top).not.toBe('');
    expect(surface?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(surface?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');

    const backdrop = document.querySelector<HTMLElement>('.ui-glass-overlay-backdrop');
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);
    expect(onBackdropClick).toHaveBeenCalledTimes(1);
  });
});
