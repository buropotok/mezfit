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


  it('rejects reentrant and queued actions before the closing animation advances', () => {
    let repeat: (() => void) | undefined;
    const phase = vi.fn();
    const day = vi.fn(() => repeat?.());
    const view = render(<FloatingActionButton label="Добавить" mode="metaball" actions={[{ label: 'День', onClick: day }, { label: 'Фаза', onClick: phase }]} />);
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(1000));
    const dayButton = view.getByRole('button', { name: 'День' });
    const phaseButton = view.getByRole('button', { name: 'Фаза' });
    repeat = () => { fireEvent.click(dayButton); fireEvent.click(phaseButton); };
    fireEvent.click(dayButton);
    expect(dayButton).toHaveProperty('disabled', true);
    expect(phaseButton).toHaveProperty('disabled', true);
    fireEvent.click(dayButton); fireEvent.click(phaseButton);
    expect(day).toHaveBeenCalledOnce(); expect(phase).not.toHaveBeenCalled();
  });

  it('hides moving bezel and gradually restores normal highlights after 450 ms', () => {
    const view = render(<FloatingActionButton label="Добавить" mode="metaball" actions={[{ label: 'День', onClick: vi.fn() }, { label: 'Фаза', onClick: vi.fn() }]} />);
    const bezel = (element: Element | null) => Number((element as HTMLElement).style.getPropertyValue('--ui-glass-surface-bezel'));
    const normal = bezel(view.container.querySelector('.ui-fab-metaball__source'));
    expect(normal).toBeGreaterThan(0);
    expect(frames.size).toBe(0);
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(200));
    expect(bezel(view.container.querySelector('.ui-fab-metaball__liquid'))).toBe(0);
    act(() => advance(250));
    const capsule = view.container.querySelector('.ui-fab-metaball__capsule') as HTMLElement;
    expect(capsule.style.width).toBe('100px');
    expect(capsule.style.height).toBe('44px');
    expect(bezel(capsule)).toBe(0);
    act(() => advance(0)); act(() => advance(60));
    expect(bezel(capsule)).toBeGreaterThan(0);
    expect(bezel(capsule)).toBeLessThan(normal);
    act(() => advance(60));
    expect(bezel(capsule)).toBeCloseTo(normal);
    expect(frames.size).toBe(0);
  });

  it('cleans up an unfinished bezel reveal', () => {
    const view = render(<FloatingActionButton label="Добавить" mode="metaball" actions={[{ label: 'День', onClick: vi.fn() }, { label: 'Фаза', onClick: vi.fn() }]} />);
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(450));
    expect(frames.size).toBeGreaterThan(0);
    view.unmount(); expect(frames.size).toBe(0);
  });

  it.each(['right', 'left'] as const)('sizes each title with 10 CSS px padding and responds to content/font changes at %s', placement => {
    let measuredDay = 132, measuredPhase = 210;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('ui-fab-metaball__label')) return 0;
      return this.textContent === 'Длинное название' ? measuredDay : measuredPhase;
    });
    const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
      observe() {}
    });
    const actions = [{ label: 'Длинное название', onClick: vi.fn() }, { label: 'Другое название', onClick: vi.fn() }] as const;
    const view = render(<FloatingActionButton label="Добавить" placement={placement} mode="metaball" icon="plus" actions={actions} />);
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(450));
    const sizes = () => [...view.container.querySelectorAll<HTMLElement>('.ui-fab-metaball__capsule')].map(node => [node.style.width, node.style.height]);
    expect(sizes()).toEqual([['152px', '44px'], ['230px', '44px']]);
    expect(view.getByRole('button', { name: 'Длинное название' }).style.width).toBe('152px');
    measuredDay = 160;
    act(() => observers.forEach(observer => observer.callback([], {} as ResizeObserver)));
    expect(sizes()).toEqual([['180px', '44px'], ['230px', '44px']]);
    measuredPhase = 250;
    view.rerender(<FloatingActionButton label="Добавить" placement={placement} mode="metaball" icon="plus" actions={[actions[0], { ...actions[1], label: 'Изменённый заголовок' }]} />);
    expect(sizes()).toEqual([['180px', '44px'], ['270px', '44px']]);
    expect(view.getByRole('button', { name: 'Изменённый заголовок' }).style.width).toBe('270px');
    view.unmount();
    observers.forEach(observer => expect(observer.disconnect).toHaveBeenCalled());
    expect(frames.size).toBe(0);
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
  it('keeps contour highlights visible before rupture and during the normal-bezel handoff', () => {
    const view = render(<FloatingActionButton label="Добавить" mode="metaball" icon="plus" actions={[{ label: 'День', onClick: vi.fn() }, { label: 'Фаза', onClick: vi.fn() }]} />);
    const highlightLayer = () => [...view.container.querySelectorAll('svg')].find(svg => svg.querySelector('radialGradient'))!;
    fireEvent.click(view.getByRole('button', { name: 'Добавить' }));
    act(() => advance(0)); act(() => advance(250));
    const before = highlightLayer(), strength = Number(before.getAttribute('opacity'));
    expect(strength).toBeGreaterThan(0);
    expect([...before.querySelectorAll('radialGradient stop:first-child')].map(stop => Number(stop.getAttribute('stop-opacity')))).toEqual([1, 1, 0, 0]);
    act(() => advance(110));
    const after = highlightLayer();
    expect(Number(after.querySelectorAll('radialGradient stop:first-child')[2].getAttribute('stop-opacity'))).toBeGreaterThan(0);
    expect(Number(after.getAttribute('opacity'))).toBeCloseTo(strength);
    act(() => advance(90));
    expect(Number(highlightLayer().getAttribute('opacity'))).toBeCloseTo(strength);
    act(() => advance(0)); act(() => advance(60));
    expect(Number(highlightLayer().getAttribute('opacity'))).toBeCloseTo(strength / 2);
    act(() => advance(60));
    expect(Number(highlightLayer().getAttribute('opacity'))).toBe(0);
    expect(frames.size).toBe(0);
  });

});
