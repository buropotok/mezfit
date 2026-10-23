/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityAction } from './IdentityAction';
import { NavbarMetaball } from './NavbarMetaball';

let availableWidth = 200;
let intrinsicTextWidth = 130;
const observers: ResizeObserverCallback[] = [];

beforeEach(() => {
  availableWidth = 200;
  intrinsicTextWidth = 130;
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const actualStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElt) => {
    const style = actualStyle(element, pseudoElt);
    if (!(element instanceof HTMLElement)) return style;
    const overrides = element.classList.contains('ui-identity-action')
      ? { paddingLeft: '2px', paddingRight: '14px', columnGap: '8px' }
      : element.classList.contains('ui-identity-action__visual')
        ? { width: '40px' }
        : null;
    if (!overrides) return style;
    // Preserve the real CSSStyleDeclaration API used by glass primitives.
    return new Proxy(style, {
      get(target, key) {
        if (typeof key === 'string' && key in overrides) {
          return overrides[key as keyof typeof overrides];
        }
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('ui-identity-action') ? availableWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('ui-identity-action__title-measure') ? intrinsicTextWidth : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function triggerResize() {
  act(() => observers.forEach(callback => callback([], {} as ResizeObserver)));
}

describe('Navbar Identity overflow priority', () => {
  it('hides a decorative icon only when the full title does not fit beside it', () => {
    const view = render(<IdentityAction icon="calendar-event" title="Пятница, 23 октября" titleRole="headline" autoHideIcon width={200} />);
    const iconSlot = view.container.querySelector<HTMLElement>('.ui-identity-action__visual');
    expect(iconSlot?.style.display).toBe('');

    availableWidth = 120;
    triggerResize();
    expect(iconSlot?.style.display).toBe('none');
    expect(view.getByRole('button', { name: 'Пятница, 23 октября' })).toBeTruthy();
    expect(view.container.querySelector('.ui-identity-action__title')?.textContent).toBe('Пятница, 23 октября');

    availableWidth = 200;
    triggerResize();
    expect(iconSlot?.style.display).toBe('');
  });

  it('re-evaluates the full text after the title changes, without an icon visibility loop', () => {
    availableWidth = 120;
    const view = render(<IdentityAction icon="calendar-event" title="Пятница, 23 октября" autoHideIcon />);
    const iconSlot = view.container.querySelector<HTMLElement>('.ui-identity-action__visual');
    expect(iconSlot?.style.display).toBe('none');
    intrinsicTextWidth = 35;
    view.rerender(<IdentityAction icon="calendar-event" title="Сегодня" autoHideIcon />);
    expect(iconSlot?.style.display).toBe('');
  });

  it('keeps an avatar even when its accompanying title overflows', () => {
    availableWidth = 90;
    intrinsicTextWidth = 400;
    const view = render(<IdentityAction avatar={{ name: 'Александр Алексеевич' }} title="Александр Алексеевич" autoHideIcon />);
    const avatarSlot = view.container.querySelector<HTMLElement>('.ui-identity-action__visual');
    expect(avatarSlot).not.toBeNull();
    expect(avatarSlot?.style.display).toBe('');
    expect(view.container.querySelector('.ui-identity-action__title-measure')).toBeNull();
    expect(view.getByRole('button', { name: 'Александр Алексеевич' })).toBeTruthy();
  });

  it('supports a title-only identity without allocating an empty icon slot', () => {
    const view = render(<IdentityAction title="Пятница, 23 октября" />);
    expect(view.container.querySelector('.ui-identity-action__visual')).toBeNull();
    expect(view.getByRole('button', { name: 'Пятница, 23 октября' })).toBeTruthy();
  });

  it('enables adaptive hiding only for icon identities in NavbarMetaball', () => {
    availableWidth = 120;
    const view = render(<NavbarMetaball
      level={1}
      identity={{ title: 'Пятница, 23 октября', icon: 'calendar-event' }}
      onBack={vi.fn()}
    />);
    const slot = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__identity-slot .ui-identity-action__visual');
    expect(slot?.style.display).toBe('none');

    view.rerender(<NavbarMetaball
      level={1}
      identity={{ title: 'Александр Алексеевич', avatar: { name: 'Александр Алексеевич' } }}
      onBack={vi.fn()}
    />);
    const avatar = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__identity-slot .ui-identity-action__visual');
    expect(avatar?.style.display).toBe('');
  });
});
