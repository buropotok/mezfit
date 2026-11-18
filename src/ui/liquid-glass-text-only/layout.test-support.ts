import { vi } from 'vitest';

/** jsdom has no layout or Shadow DOM CSS cascade. Supply measured slot geometry,
 * while leaving React, pointer dispatch, runtime and navigation owners real. */
export function installTextOnlyLayout(viewport = 280) {
  let glyphWidth = 8;
  const resizeCallbacks = new Map<ResizeObserver, ResizeObserverCallback>();
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (element instanceof HTMLElement && element.matches('[data-action-tab]')) {
      const style = document.createElement('div').style;
      style.paddingLeft = '13px';
      style.paddingRight = '13px';
      style.borderLeftWidth = '0px';
      style.borderRightWidth = '0px';
      return style;
    }
    return computedStyle(element, pseudo);
  });
  const width = (element: HTMLElement): number => {
    if (element.matches('[data-action-tab]')) return parseFloat(element.style.width) || glyphWidth + 26;
    if (element.matches('[role="tab"].tab-link')) return 90;
    if (element.classList.contains('tab-label')) return glyphWidth;
    if (element.id === 'lens' || element.id === 'lens-track') return parseFloat(element.style.width) || 44;
    return viewport;
  };
  const left = (element: HTMLElement) => {
    let result = 0;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.classList.contains('tab-link')) result += width(sibling);
      sibling = sibling.previousElementSibling;
    }
    return result;
  };
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) { return width(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function(this: HTMLElement) { return left(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) {
    return parseFloat(this.style.height) || 44;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(viewport);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) {
    return Math.max(viewport, [...this.querySelectorAll<HTMLElement>('.tab-link')].reduce((sum, link) => sum + width(link), 0));
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const w = width(this);
    const x = this.classList.contains('tab-link') ? left(this) - (this.parentElement?.scrollLeft ?? 0) : 0;
    return { x, y: 0, left: x, top: 0, right: x + w, bottom: 44, width: w, height: 44, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.set(this, callback); }
    observe() {}
    unobserve() {}
    disconnect() { resizeCallbacks.delete(this); }
  });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  });
  return {
    resizeLabel(nextWidth: number) {
      glyphWidth = nextWidth;
      // Owners ignore the entry array and re-read their current geometry.
      for (const [observer, callback] of resizeCallbacks) callback([], observer);
    },
  };
}

export function textOnlyScene(container: HTMLElement): ShadowRoot {
  for (const element of container.querySelectorAll('*')) {
    if (element.shadowRoot?.querySelector('[role="tablist"]')) return element.shadowRoot;
  }
  throw Error('Missing real Text Only ShadowRoot');
}

export function sceneElement(root: ShadowRoot, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw Error(`Missing ${selector}`);
  return element;
}
