// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiquidCollapse } from './LiquidCollapse';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('LiquidCollapse presentation lifecycle', () => {
  it('finishes once at the destination and cancels frame work on unmount', () => {
    const frame: { next?: FrameRequestCallback } = {};
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame.next = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const target = document.createElement('button');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 30, 44, 44));
    const finished = vi.fn();
    const view = render(<LiquidCollapse source={{ left: 10, top: 100, width: 200, height: 80 }}
      targetRef={{ current: target }} onFinished={finished}><span>Тренировка</span></LiquidCollapse>);
    expect(finished).not.toHaveBeenCalled();
    act(() => { frame.next?.(performance.now() + 10000); });
    expect(finished).toHaveBeenCalledTimes(1);
    view.unmount();
    act(() => { frame.next?.(performance.now() + 20000); });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
  });
  it('finishes without animation when its target is absent', () => {
    const finished = vi.fn();
    render(<LiquidCollapse source={{ left: 0, top: 100, width: 200, height: 80 }}
      targetRef={{ current: null }} onFinished={finished}><span>Тренировка</span></LiquidCollapse>);
    expect(finished).toHaveBeenCalledTimes(1);
  });
  it('respects reduced motion without preventing the accepted cancellation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const target = document.createElement('button');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 30, 44, 44));
    const finished = vi.fn();
    render(<LiquidCollapse source={{ left: 10, top: 100, width: 200, height: 80 }}
      targetRef={{ current: target }} onFinished={finished}><span>Тренировка</span></LiquidCollapse>);
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
