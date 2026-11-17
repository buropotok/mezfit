// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell, type AppDestination, type NavigationContext } from '../NavigationShell';
import { isCategoryId, type CategoryDefinition, type DiscussionOrganizationSnapshot } from '../data/cloud/discussion-organization';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import { GlassSurfaceProvider } from '../ui/GlassSurface';
import { installTextOnlyLayout, sceneElement, textOnlyScene } from '../ui/liquid-glass-text-only/layout.test-support';
import { DiscussionsPage } from './DiscussionsPage';

const state = vi.hoisted(() => ({
  db: {}, categories: [] as CategoryDefinition[], create: vi.fn(),
  next: null as ((snapshot: DiscussionOrganizationSnapshot) => void) | null,
  rows: [], peers: [],
  sources: { get: () => null, subscribe: () => () => {} },
}));
vi.mock('./DiscussionsProvider', () => ({
  useDiscussions: () => ({ rows: state.rows, unread: 0, loading: false, error: '', retry: vi.fn() }),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:11', status: 'ready', syncStatus: 'local',
    clients: state.peers, coaches: state.peers, userAvatarSources: state.sources }),
}));
vi.mock('../data/cloud/discussion-organization', async importOriginal => ({
  ...await importOriginal<typeof import('../data/cloud/discussion-organization')>(),
  DiscussionOrganizationRepository: class {
    observe(_threads: readonly DiscussionThread[], next: (snapshot: DiscussionOrganizationSnapshot) => void) {
      state.next = next;
      next({ categories: state.categories, diagnostics: [], threads: [] });
      return { unsubscribe() { if (state.next === next) state.next = null; } };
    }
    createCategory = state.create;
  },
}));

const me = { user: { id: 11, telegramUserId: '11', username: null, firstName: 'Тест', lastName: null,
  languageCode: 'ru', photoUrl: null, isPremium: false }, roles: ['client' as const, 'coach' as const] };
function Harness({ role, relationshipId }: { role: 'client' | 'coach'; relationshipId?: string }) {
  const [context, setContext] = useState<NavigationContext | null>(null);
  const [destination, setDestination] = useState<AppDestination>('discussions');
  const [, refresh] = useState(0);
  const navigate = (next: AppDestination) => { setContext(null); setDestination(next); };
  return <KonstaProvider theme="ios" dark><GlassSurfaceProvider optics={false}>
    <button onClick={() => refresh(value => value + 1)}>Обновить оболочку</button>
    <button onClick={() => navigate(destination === 'discussions' ? 'today' : 'discussions')}>Сменить экран</button>
    <NavigationShell me={me} activeRole={role} destination={destination} context={context}
      onDestinationChange={navigate} onRoleSwitch={() => {}}>
      {destination === 'discussions' ? <DiscussionsPage role={role} relationshipId={relationshipId}
        onNavigationContextChange={setContext} /> : <p>Другой экран</p>}
    </NavigationShell>
  </GlassSurfaceProvider></KonstaProvider>;
}
function dialog() { return screen.queryByRole('dialog', { name: 'Новая категория' }); }
function openByTouch(container: HTMLElement, captured = false) {
  const root = textOnlyScene(container);
  const button = sceneElement(root, '[data-action-tab]');
  const strip = sceneElement(root, '#tab-strip');
  strip.scrollLeft = strip.scrollWidth - strip.clientWidth;
  const clientX = button.offsetLeft + button.offsetWidth / 2 - strip.scrollLeft;
  fireEvent.pointerDown(button, { pointerId: 7, pointerType: 'touch', clientX, clientY: 22 });
  fireEvent.pointerUp(document, { pointerId: 7, pointerType: 'touch', clientX, clientY: 22 });
  // Model a WebView doing a fresh hit test after pointerup. On main this
  // click hits the newly mounted backdrop; with the fix it hits the strip.
  const prematureBackdrop = dialog()?.previousElementSibling;
  fireEvent.click(prematureBackdrop ?? (captured ? sceneElement(root, '#toolbar-pane') : button), { clientX, clientY: 22 });
  expect(dialog()).toBeTruthy();
  expect(prematureBackdrop).toBeUndefined();
  return root;
}
function backdrop() {
  const element = dialog()?.previousElementSibling;
  if (!(element instanceof HTMLElement)) throw Error('Missing Konsta backdrop');
  return element;
}
const id = '00000000-0000-4000-8000-000000000001';
if (!isCategoryId(id)) throw Error('Invalid fixture ID');
const category: CategoryDefinition = { id, name: 'Реабилитация', order: 0 };

beforeEach(() => {
  installTextOnlyLayout();
  state.categories = [];
  state.create.mockImplementation(async (name: string) => {
    const created = { ...category, name };
    state.categories = [created];
    return created;
  });
});
afterEach(() => {
  cleanup();
  state.next = null;
  state.create.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '');
});

describe('real category action → Dialog → NavigationShell lifecycle', () => {
  it.each([
    ['client', undefined, false, 'Тренерские'],
    ['coach', undefined, true, 'Клиентские'],
    ['coach', 'pair', false, 'Клиентские'],
  ] as const)('keeps one editable dialog after the complete touch click for %s/%s', async (role, relationshipId, captured, peerLabel) => {
    const view = render(<StrictMode><Harness role={role} relationshipId={relationshipId} /></StrictMode>);
    const root = openByTouch(view.container, captured);
    expect([...root.querySelectorAll('[role="tab"]')].some(tab => tab.textContent === peerLabel)).toBe(true);
    const opened = screen.getByRole('dialog', { name: 'Новая категория' });
    fireEvent.change(within(opened).getByLabelText('Название'), { target: { value: category.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить оболочку' }));
    const action = sceneElement(root, '[data-action-tab]');
    const strip = sceneElement(root, '#tab-strip');
    const clientX = action.offsetLeft + action.offsetWidth / 2 - strip.scrollLeft;
    fireEvent.pointerDown(action, { pointerId: 8, pointerType: 'touch', clientX, clientY: 22 });
    fireEvent.pointerUp(document, { pointerId: 8, pointerType: 'touch', clientX, clientY: 22 });
    fireEvent.click(action, { clientX, clientY: 22 });
    expect(dialog()).toBe(opened);
    expect(within(opened).getByLabelText('Название')).toHaveProperty('value', category.name);
    expect(screen.getAllByRole('dialog', { name: 'Новая категория' })).toHaveLength(1);
    const create = within(opened).getByRole('button', { name: 'Создать' });
    await act(async () => { fireEvent.click(create); fireEvent.click(create); });
    expect(state.create).toHaveBeenCalledExactlyOnceWith(category.name);
    expect(dialog()).toBeNull();
    const createdRoot = textOnlyScene(view.container);
    await waitFor(() => expect([...createdRoot.querySelectorAll('[role="tab"]')]
      .find(tab => tab.textContent === category.name)?.getAttribute('aria-selected')).toBe('true'));
    // The public fullWidth option uses the same stage contract as ProgramToolbar.
    expect(createdRoot.querySelector('.text-only-stage--full-width')).toBeTruthy();
    expect(sceneElement(createdRoot, '[data-action-tab]').offsetWidth).toBe(68);
  });

  it.each(['backdrop', 'cancel', 'back'] as const)('closes through a distinct %s action', async how => {
    const view = render(<Harness role="client" />);
    openByTouch(view.container);
    if (how === 'backdrop') fireEvent.click(backdrop());
    else if (how === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    else window.history.back();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(state.create).not.toHaveBeenCalled();
  });

  it('discards the old draft when leaving and returning to the destination', async () => {
    const view = render(<Harness role="coach" />);
    openByTouch(view.container);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Старый черновик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить экран' }));
    expect(dialog()).toBeNull();
    expect(screen.getByText('Другой экран')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сменить экран' }));
    await waitFor(() => expect(textOnlyScene(view.container)).toBeTruthy());
    expect(dialog()).toBeNull();
    openByTouch(view.container);
    expect(screen.getByLabelText('Название')).toHaveProperty('value', '');
  });
});
