/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingActionButton, FloatingActionButtonGlassProvider } from './components';

let now = 0, sequence = 0;
let frames = new Map<number, FrameRequestCallback>();
function advance(ms: number) {
  now += ms;
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(now));
}
beforeEach(() => {
  now = 0; sequence = 0; frames = new Map();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('metaball FAB mode', () => {
  it('inherits the ordinary material, reveals two actions and dispatches only the selected action', () => {
    const day = vi.fn(), phase = vi.fn();
    const view = render(<FloatingActionButtonGlassProvider preset="frosted" optics={false}>
      <FloatingActionButton label="Добавить" mode="metaball" icon="plus" actions={[{ label: 'День', onClick: day }, { label: 'Фаза', onClick: phase }]} />
    </FloatingActionButtonGlassProvider>);
    expect(view.container.querySelector('.ui-glass-surface')?.getAttribute('style')).toContain('--ui-glass-surface-blur: 14px');
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(1000));
    expect(view.getByRole('button', { name: 'День' })).not.toHaveProperty('disabled', true);
    expect(view.container.querySelector('.ui-fab-metaball__labels')?.getAttribute('style')).toContain('clip-path');
    expect(view.container.querySelectorAll('.ui-text--headline')).toHaveLength(2);
    fireEvent.click(view.getByRole('button', { name: 'День' }));
    expect(day).toHaveBeenCalledOnce(); expect(phase).not.toHaveBeenCalled();
    act(() => advance(0)); act(() => advance(1000));
    expect(view.getByRole('button', { name: 'Добавить' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('reverses on an outside tap and releases animation frames on unmount', () => {
    const view = render(<FloatingActionButton label="Добавить" mode="metaball" actions={[{ label: 'День', onClick: vi.fn() }, { label: 'Фаза', onClick: vi.fn() }]} />);
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(400));
    fireEvent.pointerDown(document.body);
    act(() => advance(0)); act(() => advance(1000));
    expect(view.getByRole('button', { name: 'Добавить' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    expect(frames.size).toBeGreaterThan(0);
    view.unmount(); expect(frames.size).toBe(0);
  });

  it('keeps hidden and disabled FABs inert', () => {
    const clicked = vi.fn();
    const actions = [{ label: 'День', onClick: clicked }, { label: 'Фаза', onClick: clicked }] as const;
    const view = render(<FloatingActionButton label="Добавить" mode="metaball" disabled actions={actions} />);
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    expect(frames.size).toBe(0); expect(clicked).not.toHaveBeenCalled();
    view.rerender(<FloatingActionButton label="Добавить" mode="metaball" isShown={false} actions={actions} />);
    expect(view.queryByRole('button')).toBeNull(); expect(frames.size).toBe(0);
  });
});
