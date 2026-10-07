/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassSurfaceProvider } from '../GlassSurface';
import { MezfitTopPanel } from './TopPanel';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MezfitTopPanel', () => {
  it('uses the default local blur and doubled dim without a page backdrop', () => {
    const onClose = vi.fn();
    const view = render(
      <MezfitTopPanel opened onClose={onClose} role="dialog" aria-label="Top panel">
        <div>Content</div>
      </MezfitTopPanel>,
    );

    const panel = view.getByRole('dialog', { name: 'Top panel' });
    const surface = panel.querySelector<HTMLElement>('.ui-mezfit-top-panel__surface--bare');
    expect(surface).not.toBeNull();
    expect(panel.style.getPropertyValue('--ui-mezfit-top-panel-blur')).toBe('3px');
    expect(panel.getAttribute('data-material')).toBe('default');
    expect(view.container.querySelector('.k-panel-backdrop')).toBeNull();

    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(panel, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 180,
    });
    fireEvent.pointerUp(panel, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 210,
      clientY: 176,
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(panel, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 180,
      clientY: 220,
    });
    fireEvent.pointerUp(panel, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 184,
      clientY: 140,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets the supplied material own blur instead of the standalone blur setting', () => {
    const view = render(
      <GlassSurfaceProvider blur={2}>
        <MezfitTopPanel
          opened
          onClose={() => {}}
          blur={3}
          materialPreset="smoked"
          role="dialog"
          aria-label="Material top panel"
        >
          <div>Content</div>
        </MezfitTopPanel>
      </GlassSurfaceProvider>,
    );

    const panel = view.getByRole('dialog', { name: 'Material top panel' });
    const surface = panel.querySelector<HTMLElement>('.ui-glass-surface');
    expect(panel.getAttribute('data-material')).toBe('glass');
    expect(surface).not.toBeNull();
    expect(surface?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('8px');
  });
});
