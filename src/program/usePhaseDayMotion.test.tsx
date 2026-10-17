// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePhaseDayMotion } from './usePhaseDayMotion';

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.unstubAllGlobals();
});
function Stack({ collapsed }: { collapsed: boolean }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  usePhaseDayMotion(collapsed, outer, inner, nodes);
  return <div ref={outer} data-testid="outer"><div ref={inner}>{['a', 'b', 'c'].map(id =>
    <div key={id} data-slot={id} ref={node => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); }} />
  )}</div></div>;
}
describe('measured phase animation lifecycle', () => {
  it('animates from one stack to unequal measured offsets in 400ms and cancels on interruption/unmount', () => {
    const cancel = vi.fn();
    const calls: { element: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; onfinish: (() => void) | null; cancel: () => void }[] = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true,
      value: function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
        const call = { element: this, frames, options, onfinish: null, cancel };
        calls.push(call); return call;
      },
    });
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.slot === 'b' ? 130 : this.dataset.slot === 'c' ? 470 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.slot === 'a' ? 118 : this.dataset.slot === 'b' ? 328 : this.dataset.slot === 'c' ? 220 : 0;
    });
    const view = render(<Stack collapsed />);
    expect(calls).toHaveLength(0);
    view.rerender(<Stack collapsed={false} />);
    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.options.duration === 400)).toBe(true);
    expect(calls[0].frames[0].height).toBe('328px');
    expect(calls[0].frames.at(-1)?.height).toBe('690px');
    expect(calls[1].frames[0].transform).toBe('translateY(0px)');
    expect(calls[2].frames[0].transform).toBe('translateY(-130px)');
    expect(calls[3].frames[0].transform).toBe('translateY(-470px)');
    expect(calls[3].frames.at(-1)?.transform).toBe('translateY(0px)');
    view.rerender(<Stack collapsed />);
    expect(cancel).toHaveBeenCalledTimes(4);
    calls[4].onfinish?.();
    expect(view.getByTestId('outer').style.visibility).toBe('hidden');
    view.rerender(<Stack collapsed={false} />);
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(12);
  });
});

it('pins the visible height before collapse and ignores stale completion after reopening', () => {
  const calls: { element: HTMLElement; onfinish: (() => void) | null; oncancel: (() => void) | null; cancel: () => void }[] = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 700, top: 0 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true,
    value: function (this: HTMLElement) {
      if (this.dataset.testid === 'outer') expect(this.style.height).toBe('700px');
      const call = { element: this, onfinish: null, oncancel: null, cancel: vi.fn() };
      calls.push(call); return call;
    },
  });
  const view = render(<Stack collapsed={false} />);
  view.rerender(<Stack collapsed />);
  const oldFinish = calls[0].onfinish;
  view.rerender(<Stack collapsed={false} />);
  oldFinish?.();
  expect(view.getByTestId('outer').style.visibility).toBe('visible');
  // Unexpected browser cancellation must reveal natural open content.
  calls[4].oncancel?.();
  expect(view.getByTestId('outer').style.height).toBe('auto');
  expect(view.getByTestId('outer').style.visibility).toBe('visible');
});

it('releases the open height when workouts resize during expansion', () => {
  let resize: (() => void) | undefined;
  let height = 100;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height, top: 0 } as DOMRect));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true,
    value: () => ({ onfinish: null, oncancel: null, cancel: vi.fn() }),
  });
  const view = render(<Stack collapsed />);
  view.rerender(<Stack collapsed={false} />);
  height = 400;
  resize?.();
  expect(view.getByTestId('outer').style.height).toBe('auto');
  expect(view.getByTestId('outer').style.visibility).toBe('visible');
});
