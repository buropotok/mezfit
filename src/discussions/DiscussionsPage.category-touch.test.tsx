// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell, type AppDestination, type NavigationContext } from '../NavigationShell';
import { isCategoryId, type CategoryDefinition, type DiscussionOrganizationSnapshot } from '../data/cloud/discussion-organization';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import { GlassSurfaceProvider } from '../ui/GlassSurface';
import { ClientCoachProvider } from '../client/ClientCoachContext';
import { installTextOnlyLayout, textOnlyScene } from '../ui/liquid-glass-text-only/layout.test-support';
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
    <ClientCoachProvider clientTelegramUserId="11" enabled={role === 'client'}>
    <NavigationShell me={me} activeRole={role} destination={destination} context={context}
      onDestinationChange={navigate} onRoleSwitch={() => {}}>
      {destination === 'discussions' ? <DiscussionsPage role={role} relationshipId={relationshipId}
        onNavigationContextChange={setContext} /> : <p>Другой экран</p>}
    </NavigationShell>
    </ClientCoachProvider>
  </GlassSurfaceProvider></KonstaProvider>;
}
function dialog() { return screen.queryByRole('dialog', { name: 'Новая категория' }); }
async function openByMenu(container: HTMLElement) {
  const root = textOnlyScene(container);
  expect(root.querySelector('[data-action-tab]')).toBeNull();
  const button = screen.getByRole('button', { name: 'Управление категориями' });
  fireEvent.pointerDown(button, { pointerId: 7, pointerType: 'touch', clientX: 258, clientY: 22 });
  fireEvent.pointerUp(button, { pointerId: 7, pointerType: 'touch', clientX: 258, clientY: 22 });
  fireEvent.click(button);
  expect(dialog()).toBeNull();
  const item = await screen.findByRole('menuitem', { name: 'Добавить категорию' });
  await waitFor(() => expect(item.closest('[inert]')).toBeNull());
  fireEvent.pointerDown(item, { pointerId: 8, pointerType: 'touch', clientX: 120, clientY: 80 });
  fireEvent.pointerUp(item, { pointerId: 8, pointerType: 'touch', clientX: 120, clientY: 80 });
  expect(dialog()).toBeNull();
  fireEvent.click(item);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await screen.findByRole('dialog', { name: 'Новая категория' });
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
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
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

describe('real category menu → presentation end → Dialog → NavigationShell lifecycle', () => {
  it.each([
    ['client', undefined, 'Тренерские'],
    ['coach', undefined, 'Клиентские'],
    ['coach', 'pair', 'Клиентские'],
  ] as const)('keeps one editable dialog after the complete touch click for %s/%s', async (role, relationshipId, peerLabel) => {
    const view = render(<StrictMode><Harness role={role} relationshipId={relationshipId} /></StrictMode>);
    const root = await openByMenu(view.container);
    expect([...root.querySelectorAll('[role="tab"]')].some(tab => tab.textContent === peerLabel)).toBe(true);
    const opened = screen.getByRole('dialog', { name: 'Новая категория' });
    fireEvent.change(within(opened).getByLabelText('Название'), { target: { value: category.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить оболочку' }));
    expect(screen.getByRole('button', { name: 'Управление категориями' })).toHaveProperty('disabled', true);
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
    expect(createdRoot.querySelector('[data-action-tab]')).toBeNull();
  });

  it('keeps one toolbar row and one menu trigger across system and custom selection', async () => {
    state.categories = [category];
    const view = render(<Harness role="client" />);
    const root = textOnlyScene(view.container);
    const toolbar = view.container.querySelector('.discussion-inbox__toolbar');
    const filter = view.container.querySelector('.discussion-inbox__filter-block');
    expect(filter?.previousElementSibling).toBe(toolbar);
    const customTab = [...root.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === category.name);
    if (!customTab) throw Error('Missing custom tab');
    fireEvent.click(customTab);
    expect(view.container.querySelector('.discussion-inbox__toolbar')).toBe(toolbar);
    expect(filter?.previousElementSibling).toBe(toolbar);
    expect(screen.getAllByRole('button', { name: 'Управление категориями' })).toHaveLength(1);
    expect(root.querySelector('[data-action-tab]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Управление категориями' }));
    expect(await screen.findByRole('menuitem', { name: 'Переименовать категорию' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Удалить категорию' })).toBeTruthy();
  });

  it.each(['backdrop', 'cancel', 'back'] as const)('closes through a distinct %s action', async how => {
    const view = render(<Harness role="client" />);
    await openByMenu(view.container);
    if (how === 'backdrop') fireEvent.click(backdrop());
    else if (how === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    else window.history.back();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(state.create).not.toHaveBeenCalled();
  });

  it('discards the old draft when leaving and returning to the destination', async () => {
    const view = render(<Harness role="coach" />);
    await openByMenu(view.container);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Старый черновик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить экран' }));
    expect(dialog()).toBeNull();
    expect(screen.getByText('Другой экран')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сменить экран' }));
    await waitFor(() => expect(textOnlyScene(view.container)).toBeTruthy());
    expect(dialog()).toBeNull();
    await openByMenu(view.container);
    expect(screen.getByLabelText('Название')).toHaveProperty('value', '');
  });
});
