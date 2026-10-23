/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityAction } from './IdentityAction';
import { NavbarMetaball } from './NavbarMetaball';

let cardWidth = 100;
let fullTitleWidth = 140;
const resizeCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  cardWidth = 100;
  fullTitleWidth = 140;
  resizeCallbacks.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (element.classList.contains('ui-identity-action')) {
        resizeCallbacks.push(this.callback);
      }
    }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('ui-identity-action') ? cardWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('ui-identity-action__title-measure') ? fullTitleWidth : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Identity Card title alignment', () => {
  it('centers the title after a decorative icon is hidden and keeps full accessible text', () => {
    const title = 'Детали программы';
    const view = render(<NavbarMetaball
      level={1}
      identity={{ title, icon: 'clipboard-list' }}
      onBack={vi.fn()}
    />);

    const identity = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__identity-slot .ui-identity-action');
    const icon = identity?.querySelector<HTMLElement>('.ui-identity-action__visual');
    const text = identity?.querySelector<HTMLElement>('.ui-identity-action__title');

    expect(icon?.style.display).toBe('none');
    expect(identity?.classList.contains('ui-identity-action--title-centered')).toBe(true);
    expect(text?.textContent).toBe(title);
    expect(identity?.getAttribute('aria-label')).toBe(title);
  });

  it('restores icon and ordinary layout when the card gets enough width', () => {
    const view = render(<IdentityAction icon="calendar-event" title="Пятница, 23 октября" autoHideIcon />);
    const card = view.getByRole('button', { name: 'Пятница, 23 октября' });
    const visual = card.querySelector<HTMLElement>('.ui-identity-action__visual');

    expect(card.classList.contains('ui-identity-action--title-centered')).toBe(true);
    cardWidth = 240;
    fullTitleWidth = 25;
    act(() => resizeCallbacks.forEach(callback => callback([], {} as ResizeObserver)));

    expect(visual?.style.display).toBe('');
    expect(card.classList.contains('ui-identity-action--title-centered')).toBe(false);
  });

  it('centers title-only identity without an unused icon slot', () => {
    const view = render(<IdentityAction title="Детали программы" titleRole="headline" />);
    const card = view.getByRole('button', { name: 'Детали программы' });
    expect(card.classList.contains('ui-identity-action--title-centered')).toBe(true);
    expect(card.querySelector('.ui-identity-action__visual')).toBeNull();
  });

  it('keeps avatar and ordinary icon layouts unchanged', () => {
    const view = render(<IdentityAction avatar={{ name: 'Александр Алексеевич' }} title="Александр Алексеевич" />);
    const avatarCard = view.getByRole('button', { name: 'Александр Алексеевич' });
    expect(avatarCard.classList.contains('ui-identity-action--title-centered')).toBe(false);
    expect(avatarCard.querySelector('.ui-identity-action__visual')).not.toBeNull();

    view.rerender(<IdentityAction icon="users" title="Клиенты" />);
    const iconCard = view.getByRole('button', { name: 'Клиенты' });
    expect(iconCard.classList.contains('ui-identity-action--title-centered')).toBe(false);
    expect(iconCard.querySelector('.ui-identity-action__visual')).not.toBeNull();
  });

  it('does not alter the standalone Back control', () => {
    const view = render(<IdentityAction variant="single" icon="chevron-left" title="Назад" />);
    expect(view.getByRole('button', { name: 'Назад' }).classList.contains('ui-identity-action--title-centered')).toBe(false);
  });
});
