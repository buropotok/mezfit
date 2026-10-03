/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityAction } from './IdentityAction';
import { MezfitNavbar } from './MezfitNavbar';
import { getUiIconAsset } from './icons/registry';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderWithKonsta(node: React.ReactNode) {
  return render(<KonstaProvider theme="ios" dark>{node}</KonstaProvider>);
}

describe('IdentityAction double navbar variant', () => {
  it('animates the whole capsule and invokes only the tapped segment after completion', () => {
    const onMenu = vi.fn();
    const onCalendar = vi.fn();
    const view = renderWithKonsta(
      <IdentityAction
        variant="double"
        actions={[
          { icon: 'dots-vertical', label: 'Меню страницы', onClick: onMenu },
          { icon: 'calendar', label: 'Открыть календарь', onClick: onCalendar },
        ]}
      />,
    );
    const menu = view.getByRole('button', { name: 'Меню страницы' });
    const root = view.container.querySelector('.ui-identity-action--double');
    expect(root).not.toBeNull();

    fireEvent.pointerDown(menu, { pointerType: 'touch', button: 0 });
    fireEvent.click(menu);

    expect(root?.classList.contains('ui-identity-action--animating')).toBe(true);
    expect(onMenu).not.toHaveBeenCalled();
    expect(onCalendar).not.toHaveBeenCalled();

    fireEvent.animationEnd(root as Element);

    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onCalendar).not.toHaveBeenCalled();
  });
});

describe('MezfitNavbar', () => {
  it('passes the configured navbar glass preset to every identity action', () => {
    const view = renderWithKonsta(
      <MezfitNavbar
        level={2}
        identity={{ title: 'Клиенты', icon: 'users' }}
        onBack={vi.fn()}
        onMenu={vi.fn()}
        onCalendar={vi.fn()}
      />,
    );

    const surfaces = [...view.container.querySelectorAll<HTMLElement>('.ui-mezfit-navbar .ui-glass-surface')];
    expect(surfaces).toHaveLength(3);
    for (const surface of surfaces) {
      expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('14px');
    }
  });

  it('orders calendar before menu and renders the calendar as a 32px outline icon', () => {
    const view = renderWithKonsta(
      <MezfitNavbar
        level={1}
        identity={{ title: 'Клиенты', icon: 'users' }}
        onBack={vi.fn()}
        onMenu={vi.fn()}
        onCalendar={vi.fn()}
      />,
    );

    const controls = [...view.container.querySelectorAll<HTMLButtonElement>('.ui-identity-action--double .ui-identity-action__segment')];
    expect(controls.map(control => control.getAttribute('aria-label'))).toEqual(['Открыть календарь', 'Меню страницы']);
    const calendarIcon = controls[0]?.querySelector<HTMLElement>('.ui-icon');
    expect(calendarIcon?.style.width).toBe('32px');
    expect(calendarIcon?.style.height).toBe('32px');
    expect(calendarIcon?.style.getPropertyValue('mask-image')).toContain(getUiIconAsset('calendar', 'outline'));
  });

  it('keeps the identity action mounted while switching from a page icon to a client avatar', () => {
    const props = {
      onBack: vi.fn(),
      onMenu: vi.fn(),
      onCalendar: vi.fn(),
    };
    const view = renderWithKonsta(
      <MezfitNavbar
        level={1}
        identity={{ title: 'Клиенты', icon: 'users' }}
        {...props}
      />,
    );
    const initialIdentity = view.container.querySelector<HTMLElement>('.ui-mezfit-navbar__identity .ui-identity-action');
    expect(initialIdentity).not.toBeNull();
    expect(initialIdentity?.style.width).toBe('100%');
    expect(initialIdentity?.style.minWidth).toBe('100%');
    expect(initialIdentity?.style.maxWidth).toBe('100%');
    expect(view.container.querySelector('.ui-mezfit-navbar__side--left')?.getAttribute('aria-hidden')).toBe('true');

    view.rerender(
      <KonstaProvider theme="ios" dark>
        <MezfitNavbar
          level={2}
          identity={{ title: 'Анна Смирнова', avatar: { name: 'Анна Смирнова' } }}
          {...props}
        />
      </KonstaProvider>,
    );

    const nextIdentity = view.container.querySelector('.ui-mezfit-navbar__identity .ui-identity-action');
    expect(nextIdentity).toBe(initialIdentity);
    expect(view.getByRole('button', { name: 'Анна Смирнова' })).toBe(initialIdentity);
    expect((view.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
