/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechCloud } from './SpeechCloud';
import * as raster from './liquidPopoverText';
import * as mesh from './liquidPopoverCanvas';

let reduced = false;
const bounds = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
beforeEach(() => {
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('ui-speech-cloud')) return bounds(0, 0, 375, 812);
    if (this.classList.contains('ui-speech-cloud__anchor')) return bounds(16, 16, 44, 44);
    if (this.classList.contains('ui-speech-cloud__avatar')) {
      const scale = Number(this.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1);
      return bounds(38 - 22 * scale, 38 - 22 * scale, 44 * scale, 44 * scale);
    }
    return bounds(0, 0, 180, 40);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const props = { text: 'Начнём с разминки', avatar: <img alt="Тренер" style={{ borderRadius: '50%' }} />, onOpenChange: vi.fn() };

describe('SpeechCloud public lifecycle', () => {
  it('keeps the actual avatar in place and follows its 100/200/100ms pulse with the aperture', () => {
    const view = render(<SpeechCloud {...props} isOpen />);
    const avatar = screen.getByAltText('Тренер');
    const wrapper = avatar.parentElement;
    advance(112);
    expect(wrapper?.style.transform).toBe('scale(1.5)');
    expect(avatar.style.transform).toBe('');
    const dim = document.querySelector('.ui-speech-cloud__scene > path');
    expect(dim?.getAttribute('d')).toContain('a33 33');
    expect(document.querySelector('.ui-speech-cloud__scene mask path')?.getAttribute('d')).toBe(dim?.getAttribute('d'));
    advance(176);
    expect(wrapper?.style.transform).toBe('scale(1.5)');
    advance(128);
    expect(wrapper?.style.transform).toBe('scale(1)');
    expect(screen.getByRole('dialog').textContent).toBe(props.text);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses Liquid Popover raster and mesh during motion, then hands off to live text', () => {
    const operations: string[] = [];
    vi.stubGlobal('CanvasRenderingContext2D', class {
      save() { operations.push('save'); }
      restore() { operations.push('restore'); }
      beginPath() {} rect() {} resetTransform() {}
      clearRect() { operations.push('clear'); }
      clip(_path?: Path2D, rule?: CanvasFillRule) {
        operations.push(rule === 'evenodd' ? 'avatar-clip' : 'text-clip');
      }
    });
    vi.stubGlobal('Path2D', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new CanvasRenderingContext2D());
    const paint = vi.spyOn(raster, 'paintLiquidPopoverText').mockReturnValue(true);
    const warp = vi.spyOn(mesh, 'paintLiquidMesh').mockImplementation(() => { operations.push('mesh'); });
    render(<SpeechCloud {...props} isOpen />);
    advance(160);
    expect(paint).toHaveBeenCalled();
    expect(paint.mock.calls[0][1].textContent).toBe(props.text);
    expect(warp).toHaveBeenCalled();
    // Every frame clears old glyphs before the expanding aperture is clipped.
    expect(operations.slice(-5)).toEqual(['clear', 'save', 'avatar-clip', 'mesh', 'restore']);
    expect(warp.mock.calls.at(-1)?.at(-1)).toBeInstanceOf(Path2D);
    expect(screen.queryByRole('dialog')).toBeNull();
    advance(320);
    expect(screen.getByRole('dialog').textContent).toBe(props.text);
    expect(document.querySelector<HTMLCanvasElement>('.ui-speech-cloud__canvas')?.style.opacity).toBe('0');
    const preparations = paint.mock.calls.length;
    fireEvent.scroll(screen.getByRole('dialog'));
    advance(32);
    expect(paint).toHaveBeenCalledTimes(preparations);
  });
  it('closes through the controlled callback, reverses, and can reopen', () => {
    const change = vi.fn();
    const view = render(<SpeechCloud {...props} onOpenChange={change} isOpen />);
    advance(480);
    fireEvent.click(document.querySelector('.ui-speech-cloud__scene')!);
    expect(change).toHaveBeenCalledWith(false);
    view.rerender(<SpeechCloud {...props} onOpenChange={change} isOpen={false} />);
    advance(480);
    expect(document.querySelector('.ui-speech-cloud')).toBeNull();
    expect(screen.getByAltText('Тренер')).toBeTruthy();
    view.rerender(<SpeechCloud {...props} onOpenChange={change} isOpen />);
    advance(112);
    expect(screen.getByAltText('Тренер').parentElement?.style.transform).toBe('scale(1.5)');
  });
  it('settles without a pulse under reduced motion, including Strict Mode cleanup', () => {
    reduced = true;
    const view = render(<StrictMode><SpeechCloud {...props} isOpen /></StrictMode>);
    advance(32);
    expect(screen.getByRole('dialog').textContent).toBe(props.text);
    expect(screen.getByAltText('Тренер').parentElement?.style.transform).toBe('scale(1)');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not create an overlay for empty text and cancels an interrupted opening', () => {
    const view = render(<SpeechCloud {...props} text=" " isOpen />);
    expect(document.querySelector('.ui-speech-cloud')).toBeNull();
    view.rerender(<SpeechCloud {...props} isOpen />);
    advance(32);
    view.rerender(<SpeechCloud {...props} isOpen={false} />);
    advance(480);
    expect(document.querySelector('.ui-speech-cloud')).toBeNull();
    expect(screen.getByAltText('Тренер').parentElement?.style.transform).toBe('');
  });
});
