/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityAction } from './IdentityAction';
import { MezfitNavbar } from './MezfitNavbar';

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
    const initialIdentity = view.container.querySelector('.ui-mezfit-navbar__identity .ui-identity-action');
    expect(initialIdentity).not.toBeNull();
    expect((view.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(true);

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
