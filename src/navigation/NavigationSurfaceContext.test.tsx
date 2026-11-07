// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NavigationShell, type AppDestination, type NavigationContext } from '../NavigationShell';
import { useNavigationSurfaceContext } from './NavigationSurfaceContext';
vi.mock('../client/ClientCoachSelectorModal', () => ({ ClientCoachSelectorModal: () => null }));
const me = { user: { id: 1, telegramUserId: '1', username: null, firstName: 'Тест', lastName: null,
  languageCode: 'ru', photoUrl: null, isPremium: false }, roles: ['client' as const] };
beforeEach(() => {
  window.history.replaceState({}, '');
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); window.history.replaceState({}, ''); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([null, { title: 'Программа', scrollKey: 'program:exact', contentMode: 'viewport' as const }])(
  'preserves the actual shell scroll surface and layout through an overlay for %j', parent => {
    function Source({ open, close }: { open: (value: NavigationContext) => void; close: () => void }) {
      const context = useNavigationSurfaceContext();
      return <><button onClick={() => open({ ...context, level: 2, title: context?.title ?? 'Источник', onBack: close })}>Обсуждения</button>
        <button onClick={close}>Закрыть</button><input aria-label="Фильтр" defaultValue="Активные" /></>;
    }
    function Harness() {
      const [overlay, setOverlay] = useState<NavigationContext | null>(null);
      return <NavigationShell me={me} activeRole="client" destination="programs" context={overlay ?? parent}
        onDestinationChange={vi.fn()} onRoleSwitch={vi.fn()}>
        <Source open={setOverlay} close={() => setOverlay(null)} />
      </NavigationShell>;
    }
    const view = render(<Harness />);
    const scroller = view.container.querySelector<HTMLElement>('.navigation-content');
    if (!scroller) throw Error('Missing shell scroll owner');
    scroller.scrollTop = 317;
    fireEvent.scroll(scroller);
    fireEvent.change(screen.getByLabelText('Фильтр'), { target: { value: 'Ноги' } });
    fireEvent.click(screen.getByText('Обсуждения'));
    expect(scroller.scrollTop).toBe(317);
    expect(scroller.classList.contains('navigation-content--viewport')).toBe(Boolean(parent?.contentMode));
    fireEvent.click(screen.getByText('Закрыть'));
    expect(scroller.scrollTop).toBe(317);
    expect((screen.getByLabelText('Фильтр') as HTMLInputElement).value).toBe('Ноги');
  },
);

it('consumes same-source Back before a later forward destination change', () => {
  function Source({ open, close, destination }: { open: (context: NavigationContext) => void;
    close: () => void; destination: (value: AppDestination) => void }) {
    const context = useNavigationSurfaceContext();
    return <><button onClick={() => open({ ...context, level: 2, title: 'Обсуждения', onBack: close })}>Открыть</button>
      <button onClick={() => destination('history')}>В историю</button>
      <button onClick={() => destination('programs')}>К программам</button></>;
  }
  function Harness() {
    const [overlay, setOverlay] = useState<NavigationContext | null>(null);
    const [destination, setDestination] = useState<AppDestination>('programs');
    return <NavigationShell me={me} activeRole="client" destination={destination} context={overlay}
      onDestinationChange={setDestination} onRoleSwitch={vi.fn()}>
      <Source open={setOverlay} close={() => setOverlay(null)} destination={setDestination} />
    </NavigationShell>;
  }
  const view = render(<Harness />);
  const scroller = view.container.querySelector<HTMLElement>('.navigation-content');
  if (!scroller) throw Error('Missing source scroller');
  fireEvent.click(screen.getByText('В историю')); scroller.scrollTop = 125; fireEvent.scroll(scroller);
  fireEvent.click(screen.getByText('К программам')); scroller.scrollTop = 317; fireEvent.scroll(scroller);
  fireEvent.click(screen.getByText('Открыть'));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(scroller.scrollTop).toBe(317);
  fireEvent.click(screen.getByText('В историю'));
  expect(scroller.scrollTop).toBe(0);
});
