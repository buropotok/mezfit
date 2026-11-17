// @vitest-environment jsdom
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCUSSION_TITLE_MAX_LENGTH, discussionAnchorKey } from '../../shared/discussion-anchor';
import { NavigationShell, type AppDestination, type NavigationContext } from '../NavigationShell';
import { CoachShell } from '../coach/CoachShell';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import type { DiscussionScope, DiscussionThread } from '../data/cloud/discussion-contracts';
import { isCategoryId, type AssignableDiscussionCategory, type CategoryDefinition, type DiscussionOrganizationSnapshot } from '../data/cloud/discussion-organization';
import type { CreateFreeDiscussion } from '../data/cloud/discussions';
import type { TelegramBackButton } from '../telegram';
import type { LiquidGlassIconOnlyProps, LiquidGlassTextOnlyProps, MezfitDialogProps } from '../ui';
import { DiscussionsPage } from './DiscussionsPage';
import type { DiscussionInboxRow } from './DiscussionsProvider';

const state = vi.hoisted(() => ({
  db: {}, actor: 'tg:22', status: 'ready' as 'ready' | 'loading' | 'error',
  coaches: [] as CloudContact[], clients: [] as CloudContact[], categories: [] as CategoryDefinition[],
  rows: [] as DiscussionInboxRow[], saved: [] as DiscussionThread[],
  assignments: new Map<string, AssignableDiscussionCategory>(),
  create: vi.fn<(db: object, actor: string, scope: DiscussionScope, input: CreateFreeDiscussion) => Promise<DiscussionThread>>(),
  assign: vi.fn<(thread: DiscussionThread, category: AssignableDiscussionCategory) => Promise<void>>(),
  list: vi.fn<() => Promise<CategoryDefinition[]>>(),
}));

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: state.db, actorUserId: state.actor, clients: state.clients, coaches: state.coaches,
    status: state.status, syncStatus: 'local', refresh: vi.fn(), retrySync: vi.fn(),
  }),
}));
vi.mock('./DiscussionsProvider', () => ({
  useDiscussions: () => ({ rows: state.rows, unread: 5, error: '', loading: false, retry: vi.fn() }),
}));
vi.mock('../data/cloud/discussions', async original => ({
  ...await original<typeof import('../data/cloud/discussions')>(),
  DiscussionRepository: class {
    constructor(readonly db: object, readonly actorUserId: string, readonly scope: DiscussionScope) {}
    createFreeDiscussion(input: CreateFreeDiscussion) { return state.create(this.db, this.actorUserId, this.scope, input); }
  },
  observeDiscussionNotificationThread: () => ({ unsubscribe() {} }),
}));
vi.mock('../data/cloud/discussion-organization', async original => ({
  ...await original<typeof import('../data/cloud/discussion-organization')>(),
  DiscussionOrganizationRepository: class {
    observe(threads: DiscussionThread[], next: (snapshot: DiscussionOrganizationSnapshot) => void) {
      next({ categories: state.categories, diagnostics: [], threads: threads.map(thread => ({ thread,
        category: state.assignments.get(thread.id) ?? 'coach', ownAssignment: null, peerCategorized: false, diagnostics: [],
      })) });
      return { unsubscribe() {} };
    }
    listCategories = state.list;
    assignThread = state.assign;
  },
}));
vi.mock('../contacts/CloudContactAvatar', () => ({
  AVATAR_LOADING_SRC: '', useCloudContactAvatarUrl: () => undefined,
  CloudContactAvatar: ({ contact }: { contact: CloudContact }) => <img alt={`Аватар ${contact.displayName}`} />,
}));
vi.mock('../client/ClientCoachSelectorModal', () => ({ ClientCoachSelectorModal: () => null }));
vi.mock('../profile/PublishedUserProfile', () => ({ PublishedUserProfile: () => null }));
vi.mock('./DiscussionSheet', () => ({
  DiscussionSheet: ({ threadId, contextLabel, repository, parentNavigation, onNavigationContextChange, onBack, resolveAuthor }: {
    threadId: string; contextLabel: string; repository: { scope: DiscussionScope };
    parentNavigation: NavigationContext | null; onNavigationContextChange: (value: NavigationContext | null) => void;
    onBack: () => void; resolveAuthor: (id: string) => { name: string };
  }) => {
    useEffect(() => {
      onNavigationContextChange({ ...parentNavigation, title: contextLabel, onBack });
      return () => onNavigationContextChange(parentNavigation);
    }, [parentNavigation, contextLabel, onBack, onNavigationContextChange]);
    return <section role="dialog" aria-label={contextLabel} data-thread={threadId} data-realm={repository.scope.realmId}>
      <span>{resolveAuthor('peer').name}</span>
      <button onClick={onBack}>Закрыть чат</button>
    </section>;
  },
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, hidden, value, onValueChange, actionTab }: LiquidGlassTextOnlyProps) => <div role="tablist" hidden={hidden}>
    {tabs.map(tab => <button key={tab.value} role="tab" aria-selected={value === tab.value}
      onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}
    {actionTab ? <button aria-label={actionTab.ariaLabel} onClick={actionTab.onClick}>{actionTab.label}</button> : null}
  </div>,
}));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  LiquidGlassIconOnly: ({ fab, hidden }: LiquidGlassIconOnlyProps) => <div hidden={hidden}>{fab}</div>,
  LiquidGlassFloatingActionSlot: ({ children }: { children: ReactNode }) => <div data-testid="workspace-fab">{children}</div>,
  MezfitBottomSheet: ({ opened, label, children }: { opened: boolean; label: string; children: ReactNode }) =>
    opened ? <section role="dialog" aria-label={label}>{children}</section> : null,
  MezfitDialog: ({ opened, title, children, buttons, 'aria-label': label }: MezfitDialogProps) =>
    opened ? <section role="dialog" aria-label={label}>{title}{children}{buttons}</section> : null,
  DatePicker: ({ opened, onClose }: { opened: boolean; onClose: () => void }) =>
    opened ? <button onClick={onClose}>Закрыть даты</button> : null,
}));

const coachOne = { relationshipId: 'with-coach-11', displayName: 'Анна', userId: 'tg:11', telegramUserId: '11' };
const coachTwo = { relationshipId: 'with-coach-33', displayName: 'Ольга', userId: 'tg:33', telegramUserId: '33' };
const clientOne = { relationshipId: 'with-coach-11', displayName: 'Лена', userId: 'tg:22', telegramUserId: '22' };
const clientTwo = { relationshipId: 'with-client-44', displayName: 'Мария', userId: 'tg:44', telegramUserId: '44' };
function custom(id: string, name: string): CategoryDefinition {
  if (!isCategoryId(id)) throw new Error('Invalid fixture category');
  return { id, name, order: 0 };
}
const habits = custom('00000000-0000-4000-8000-000000000001', 'Привычки');
const plans = custom('00000000-0000-4000-8000-000000000002', 'Цели');
const me = { user: { id: 22, telegramUserId: '22', username: null, firstName: 'Автор', lastName: null,
  languageCode: 'ru', photoUrl: null, isPremium: false }, roles: ['client', 'coach'] as const };
const workspaceContext: NavigationContext = { level: 2, title: 'Карточка клиента' };

function Harness({ role = 'client', destination = 'discussions', relationshipId, notificationMessageId }: {
  role?: 'client' | 'coach'; destination?: AppDestination; relationshipId?: string; notificationMessageId?: string;
}) {
  const [navigation, setNavigation] = useState<NavigationContext | null>(null);
  return <NavigationShell me={{ ...me, roles: [...me.roles] }} activeRole={role} destination={destination}
    context={navigation ?? (relationshipId ? workspaceContext : null)} onDestinationChange={() => {}} onRoleSwitch={() => {}}>
    {role === 'coach' && !relationshipId ? <CoachShell initData="test-init" destination={destination}
      notificationMessageId={notificationMessageId} onNavigationContextChange={setNavigation} />
      : destination === 'discussions' || relationshipId ? <DiscussionsPage role={role} relationshipId={relationshipId}
        notificationMessageId={notificationMessageId} onNavigationContextChange={setNavigation} /> : null}
  </NavigationShell>;
}

function persist(scope: DiscussionScope, input: CreateFreeDiscussion): DiscussionThread {
  const anchor = { kind: 'free' as const, threadId: input.id };
  const thread = { ...scope, owner: scope.realmId, id: input.id, anchor, anchorKey: discussionAnchorKey(scope, anchor),
    derivedTitleSnapshot: input.title, contextPath: [], createdAt: input.createdAt, lastActivityAt: input.createdAt };
  state.saved.push(thread);
  return thread;
}
function row(thread: DiscussionThread, contact: CloudContact, unread = 0): DiscussionInboxRow {
  return { thread, contact, latest: null, unread, hasAttachments: false };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const fab = () => screen.queryByRole('button', { name: 'Создать чат' });
function click(name: string, role = 'button') { fireEvent.click(screen.getByRole(role, { name })); }
function popBack() { act(() => { window.dispatchEvent(new PopStateEvent('popstate')); }); }
function start(peer = `Выбрать тренера ${coachTwo.displayName}`, title = 'Мой чат') {
  click('Создать чат');
  click(peer);
  fireEvent.change(screen.getByLabelText('Название чата'), { target: { value: title } });
}

beforeEach(() => {
  state.db = {};
  state.actor = 'tg:22';
  state.status = 'ready';
  state.coaches = [coachOne, coachTwo];
  state.clients = [clientOne, clientTwo];
  state.categories = [habits, plans];
  state.rows = [];
  state.saved = [];
  state.assignments.clear();
  state.create.mockImplementation(async (_db, _actor, scope, input) => persist(scope, input));
  state.list.mockImplementation(async () => state.categories);
  state.assign.mockImplementation(async (thread, category) => { state.assignments.set(thread.id, category); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState({}, '');
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '');
  delete window.Telegram;
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('creating free discussions from the standard navigation FAB', () => {
  it.each([
    ['Питание', 'nutrition'], ['Личное', 'personal'], ['Привычки', { kind: 'custom', id: habits.id }],
  ] satisfies [string, AssignableDiscussionCategory][])('assigns the selected %s category and opens the chosen coach before feed emission', async (tab, category) => {
    const view = render(<Harness />);
    click(tab, 'tab');
    click('Создать чат');
    const picker = screen.getByRole('dialog', { name: 'Выбрать тренера' });
    expect(fab()).toBeNull();
    expect(within(picker).getAllByRole('img')).toHaveLength(2);
    fireEvent.change(within(picker).getByLabelText('Поиск тренера'), { target: { value: 'ОЛЬ' } });
    expect(within(picker).queryByRole('button', { name: 'Выбрать тренера Анна' })).toBeNull();
    click('Выбрать тренера Ольга');
    fireEvent.change(screen.getByLabelText('Название чата'), { target: { value: '  Разбор  ' } });
    click('Создать');
    const sheet = await screen.findByRole('dialog', { name: 'Разбор' });
    const [saved] = state.saved;
    expect(state.create).toHaveBeenCalledWith(state.db, 'tg:22', {
      realmId: coachTwo.relationshipId, coachClientId: coachTwo.relationshipId,
    }, expect.objectContaining({ title: 'Разбор' }));
    expect(state.assign).toHaveBeenCalledWith(saved, category);
    expect(sheet.getAttribute('data-realm')).toBe(coachTwo.relationshipId);
    expect(within(sheet).getByText('Ольга')).toBeTruthy();
    expect(fab()).toBeNull();
    expect(state.rows).toHaveLength(0);

    state.rows = [row({ ...saved }, coachTwo)];
    view.rerender(<Harness />);
    expect(screen.getAllByRole('dialog', { name: 'Разбор' })).toEqual([sheet]);
    click('Закрыть чат');
    expect(screen.getByRole('button', { name: 'Обсуждение: Ольга, Разбор' })).toBeTruthy();
    expect(fab()).toBeTruthy();

    view.unmount();
    render(<Harness />);
    click(tab, 'tab');
    expect(screen.getByRole('button', { name: 'Обсуждение: Ольга, Разбор' })).toBeTruthy();
  });

  it('keeps the category action distinct and hides the FAB for unsupported tabs and covered global surfaces', () => {
    const view = render(<Harness />);
    for (const tab of ['Тренировки', 'Тренерские']) { click(tab, 'tab'); expect(fab()).toBeNull(); }
    for (const tab of ['Личное', 'Питание', 'Цели', 'Привычки']) { click(tab, 'tab'); expect(fab()).toBeTruthy(); }
    click('Создать категорию');
    expect(screen.getByRole('dialog', { name: 'Новая категория' })).toBeTruthy();
    expect(fab()).toBeNull();
    click('Отмена');
    click('С даты');
    expect(fab()).toBeNull();
    click('Закрыть даты');
    expect(fab()).toBeTruthy();
    view.rerender(<Harness notificationMessageId="linked-message" />);
    expect(fab()).toBeNull();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('supports both coach surfaces, restricts a workspace to its client, and restores the directory FAB', async () => {
    state.actor = 'tg:11';
    const view = render(<Harness role="coach" />);
    click('Клиентские', 'tab');
    expect(fab()).toBeNull();
    click('Питание', 'tab');
    click('Поиск клиента');
    expect(fab()).toBeNull();
    click('Закрыть поиск клиентов');
    start('Выбрать клиента Мария', 'Общий чат');
    click('Создать');
    const globalChat = await screen.findByRole('dialog', { name: 'Общий чат' });
    expect(globalChat.getAttribute('data-realm')).toBe(clientTwo.relationshipId);
    popBack();
    expect(fab()).toBeTruthy();

    view.rerender(<Harness role="coach" destination="clients" />);
    expect(screen.getByRole('button', { name: 'Добавить клиента' })).toBeTruthy();
    click('Открыть клиента Лена');
    const workspace = screen.getByRole('group', { name: 'Разделы клиента Лена' });
    fireEvent.click(within(workspace).getByRole('tab', { name: 'Обсуждения' }));
    click('Личное', 'tab');
    expect(within(screen.getByTestId('workspace-fab')).getByRole('button', { name: 'Создать чат' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить клиента' })).toBeNull();
    click('Создать чат');
    expect(screen.queryByRole('button', { name: 'Выбрать клиента Мария' })).toBeNull();
    expect(screen.queryByTestId('workspace-fab')).toBeNull();
    click('Выбрать клиента Лена');
    fireEvent.change(screen.getByLabelText('Название чата'), { target: { value: 'Чат из карточки' } });
    click('Создать');
    const scoped = await screen.findByRole('dialog', { name: 'Чат из карточки' });
    expect(scoped.getAttribute('data-realm')).toBe(clientOne.relationshipId);
    popBack();
    expect(within(workspace).getByRole('tab', { name: 'Обсуждения' }).getAttribute('aria-selected')).toBe('true');
    expect(fab()).toBeTruthy();
    popBack();
    expect(fab()).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить клиента' })).toBeTruthy();
  });

  it('locks rapid submit and Back while saving, then retries only assignment for the exact saved thread', async () => {
    const firstAssignment = deferred<void>();
    state.assign.mockReturnValueOnce(firstAssignment.promise);
    render(<StrictMode><Harness /></StrictMode>);
    click('Питание', 'tab');
    start();
    const create = screen.getByRole('button', { name: 'Создать' });
    act(() => { create.click(); create.click(); });
    await waitFor(() => expect(state.assign).toHaveBeenCalledTimes(1));
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Сохранение…' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Отмена' }).disabled).toBe(true);
    popBack();
    expect(screen.getByRole('dialog', { name: 'Создать чат' })).toBeTruthy();
    await act(async () => { firstAssignment.reject(new Error('local assignment failed')); });
    expect(screen.getByRole('alert').textContent).toContain('Чат создан. Не удалось назначить категорию.');
    click('Повторить назначение');
    await screen.findByRole('dialog', { name: 'Мой чат' });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.assign).toHaveBeenNthCalledWith(2, state.saved[0], 'nutrition');
    expect(state.saved).toHaveLength(1);
    popBack();
    start();
    click('Создать');
    await screen.findByRole('dialog', { name: 'Мой чат' });
    expect(state.saved).toHaveLength(2);
    expect(state.saved[0].id).not.toBe(state.saved[1].id);
  });

  it('reuses the same prepared input when the user retries an interrupted thread save', async () => {
    state.create.mockRejectedValueOnce(new Error('local write interrupted'));
    render(<Harness />);
    click('Личное', 'tab');
    start();
    click('Создать');
    await screen.findByText('Не удалось создать чат. Повторите попытку.');
    expect(state.assign).not.toHaveBeenCalled();
    click('Создать');
    await screen.findByRole('dialog', { name: 'Мой чат' });
    expect(state.create.mock.calls[0][3]).toBe(state.create.mock.calls[1][3]);
    expect(state.saved).toHaveLength(1);
  });

  it('reports a successful save on its own tab without opening a chat for a recently revoked pair', async () => {
    const assignment = deferred<void>();
    state.assign.mockReturnValueOnce(assignment.promise);
    const view = render(<Harness />);
    click('Личное', 'tab');
    start();
    click('Создать');
    await waitFor(() => expect(state.assign).toHaveBeenCalledTimes(1));
    state.coaches = [coachOne];
    view.rerender(<Harness />);
    await act(async () => { assignment.resolve(); });
    expect(screen.queryByRole('dialog', { name: 'Мой чат' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Собеседник больше недоступен');
    click('Тренировки', 'tab');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows local contact loading and empty states, and supports Back and cancel without a write', () => {
    state.coaches = [];
    state.status = 'loading';
    const view = render(<Harness />);
    click('Личное', 'tab');
    click('Создать чат');
    expect(screen.getByText('Загружаем список собеседников…')).toBeTruthy();
    state.status = 'ready';
    view.rerender(<Harness />);
    expect(screen.getByText('Нет доступных тренеров')).toBeTruthy();
    popBack();
    expect(screen.queryByRole('dialog', { name: 'Выбрать тренера' })).toBeNull();
    state.coaches = [coachOne];
    view.rerender(<Harness />);
    start('Выбрать тренера Анна');
    popBack();
    expect(screen.getByRole('dialog', { name: 'Выбрать тренера' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Создать чат' })).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбрать тренера' })).getByRole('button', { name: 'Назад' }));
    start('Выбрать тренера Анна');
    click('Отмена');
    expect(screen.queryByRole('dialog', { name: 'Создать чат' })).toBeNull();
    expect(fab()).toBeTruthy();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('uses Telegram Back and the browser entry to close the current creation step', () => {
    const backButton: TelegramBackButton = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    window.Telegram = { WebApp: { initData: 'test', colorScheme: 'dark', ready: vi.fn(), expand: vi.fn(), BackButton: backButton } };
    render(<Harness />);
    click('Личное', 'tab');
    start();
    const handler = vi.mocked(backButton.onClick).mock.lastCall?.[0];
    if (!handler) throw new Error('Telegram Back was not registered');
    handler();
    expect(window.history.back).toHaveBeenCalledTimes(1);
    popBack();
    expect(screen.getByRole('dialog', { name: 'Выбрать тренера' })).toBeTruthy();
    popBack();
    expect(screen.queryByRole('dialog', { name: 'Выбрать тренера' })).toBeNull();
    expect(fab()).toBeTruthy();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('rejects invalid titles and rechecks a deleted category and revoked pair at submit', async () => {
    const view = render(<Harness />);
    click('Привычки', 'tab');
    start(undefined, '   ');
    click('Создать');
    expect(screen.getByRole('alert').textContent).toContain('Введите название чата');
    const input = screen.getByLabelText('Название чата');
    fireEvent.change(input, { target: { value: 'А'.repeat(DISCUSSION_TITLE_MAX_LENGTH + 1) } });
    click('Создать');
    expect(screen.getByRole('alert').textContent).toContain(`до ${DISCUSSION_TITLE_MAX_LENGTH}`);
    fireEvent.change(input, { target: { value: 'А\u0001Б' } });
    click('Создать');
    await screen.findByText(/без управляющих знаков/);
    fireEvent.change(input, { target: { value: 'Разбор' } });
    state.list.mockResolvedValueOnce([]);
    click('Создать');
    await screen.findByText('Выбранная категория больше недоступна.');
    state.coaches = [coachOne];
    view.rerender(<Harness />);
    click('Создать');
    await screen.findByText(/Этот собеседник больше недоступен/);
    popBack();
    expect(screen.queryByRole('button', { name: 'Выбрать тренера Ольга' })).toBeNull();
    click('Выбрать тренера Анна');
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each(['tab', 'account', 'role', 'destination', 'unmount'] as const)(
    'finishes the accepted local assignment without stale navigation after a %s change', async change => {
      const assignment = deferred<void>();
      state.assign.mockReturnValueOnce(assignment.promise);
      const view = render(<Harness />);
      click('Личное', 'tab');
      start();
      click('Создать');
      await waitFor(() => expect(state.assign).toHaveBeenCalledTimes(1));
      switch (change) {
        case 'tab': click('Тренировки', 'tab'); break;
        case 'account': state.actor = 'tg:99'; state.db = {}; view.rerender(<Harness />); break;
        case 'role': view.rerender(<Harness role="coach" />); break;
        case 'destination': view.rerender(<Harness destination="analytics" />); break;
        case 'unmount': view.unmount(); break;
      }
      await act(async () => {
        if (change === 'tab') assignment.reject(new Error('late failure'));
        else assignment.resolve();
      });
      expect(screen.queryByRole('dialog', { name: 'Создать чат' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Мой чат' })).toBeNull();
      expect(screen.queryByText(/Не удалось назначить категорию/)).toBeNull();
      expect(state.saved).toHaveLength(1);
    });

  it('drops an immediately opened chat if its verified pair disappears and never reopens it on contact refresh', async () => {
    const view = render(<Harness />);
    click('Личное', 'tab');
    start();
    click('Создать');
    await screen.findByRole('dialog', { name: 'Мой чат' });
    state.coaches = [coachOne];
    view.rerender(<Harness />);
    expect(screen.queryByRole('dialog', { name: 'Мой чат' })).toBeNull();
    state.coaches = [coachOne, coachTwo];
    view.rerender(<Harness />);
    expect(screen.queryByRole('dialog', { name: 'Мой чат' })).toBeNull();
  });

  it('finishes assigning a just-saved thread in its original pair after the scoped workspace changes', async () => {
    state.actor = 'tg:11';
    const saved = deferred<DiscussionThread>();
    state.create.mockReturnValueOnce(saved.promise);
    const page = (relationshipId: string) => <Harness role="coach" destination="clients" relationshipId={relationshipId} />;
    const view = render(page(clientOne.relationshipId));
    click('Личное', 'tab');
    start('Выбрать клиента Лена');
    click('Создать');
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    const [, , scope, input] = state.create.mock.calls[0];
    const thread = persist(scope, input);
    view.rerender(page(clientTwo.relationshipId));
    await act(async () => { saved.resolve(thread); });
    expect(state.assign).toHaveBeenCalledWith(thread, 'personal');
    expect(thread.realmId).toBe(clientOne.relationshipId);
    expect(screen.queryByRole('dialog', { name: 'Мой чат' })).toBeNull();
    click('Личное', 'tab');
    click('Создать чат');
    expect(screen.getByRole('button', { name: 'Выбрать клиента Мария' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Выбрать клиента Лена' })).toBeNull();
  });
});
