/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingActionButton, FloatingActionButtonGlassProvider } from './components';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FAB glass appearance', () => {
  it('updates the material and optical work from the shared settings without remounting the action', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onClick = vi.fn();
    const view = render(
      <FloatingActionButtonGlassProvider preset="clear" optics={false}>
        <FloatingActionButton label="Добавить" onClick={onClick}>+</FloatingActionButton>
      </FloatingActionButtonGlassProvider>,
    );
    const button = view.getByRole('button', { name: 'Добавить' });
    expect(button.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
    expect(getContext).not.toHaveBeenCalled();

    view.rerender(
      <FloatingActionButtonGlassProvider preset="frosted" optics>
        <FloatingActionButton label="Добавить" onClick={onClick}>+</FloatingActionButton>
      </FloatingActionButtonGlassProvider>,
    );
    expect(view.getByRole('button', { name: 'Добавить' })).toBe(button);
    expect(button.style.getPropertyValue('--ui-glass-surface-blur')).toBe('14px');
    expect(getContext).toHaveBeenCalled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    getContext.mockClear();
    view.rerender(
      <FloatingActionButtonGlassProvider preset="blue" optics={false}>
        <FloatingActionButton label="Добавить" onClick={onClick}>+</FloatingActionButton>
      </FloatingActionButtonGlassProvider>,
    );
    expect(button.style.getPropertyValue('--ui-glass-surface-blur')).toBe('10px');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('honors an explicit preset and optics=false over shared settings while preserving caller layout', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const view = render(
      <FloatingActionButtonGlassProvider preset="frosted" optics>
        <FloatingActionButton
          label="Подтвердить"
          glassPreset="clear"
          glassOptics={false}
          style={{ bottom: 32 }}
        >ОК</FloatingActionButton>
      </FloatingActionButtonGlassProvider>,
    );
    const button = view.getByRole('button', { name: 'Подтвердить' });
    expect(button.style.bottom).toBe('32px');
    expect(button.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('does no optical work for a hidden action and keeps disabled actions inert', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onClick = vi.fn();
    const view = render(
      <FloatingActionButtonGlassProvider preset="clear" optics>
        <FloatingActionButton label="Добавить" isShown={false} onClick={onClick}>+</FloatingActionButton>
      </FloatingActionButtonGlassProvider>,
    );
    const hiddenButton = view.getByRole('button', { hidden: true });
    fireEvent.click(hiddenButton);
    expect(onClick).not.toHaveBeenCalled();
    expect(getContext).not.toHaveBeenCalled();

    view.rerender(
      <FloatingActionButtonGlassProvider preset="clear" optics={false}>
        <FloatingActionButton label="Добавить" disabled onClick={onClick}>+</FloatingActionButton>
      </FloatingActionButtonGlassProvider>,
    );
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
