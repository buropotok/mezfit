// @vitest-environment jsdom
import { StrictMode, useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell, type NavigationContext } from '../NavigationShell';
import {
  isCategoryId, type CategoryDefinition, type DiscussionOrganizationSnapshot, type ResolvedDiscussionCategory,
} from '../data/cloud/discussion-organization';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import type { LiquidGlassTextOnlyProps, LiquidGlassIconOnlyProps, LiquidPopoverProps } from '../ui';
import { DiscussionsPage } from './DiscussionsPage';
import type { DiscussionInboxRow } from './DiscussionsProvider';
import { message, thread } from './discussion-fixture.test-support';

interface Observation {
  db: object;
  actor: string;
  threads: readonly DiscussionThread[];
  next: (value: DiscussionOrganizationSnapshot) => void;
  error: (error: unknown) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
  db: {},
  actor: 'tg:11',
  rows: [] as DiscussionInboxRow[],
  unread: 0,
  observers: [] as Observation[],
  create: vi.fn(), rename: vi.fn(), remove: vi.fn(), assign: vi.fn(), clear: vi.fn(),
  ensure: vi.fn(), get: vi.fn(), notification: vi.fn(),
}));
const peers = [
  { relationshipId: 'pair', displayName: 'Анна', userId: 'tg:22', telegramUserId: '22' },
  { relationshipId: 'other-pair', displayName: 'Ольга', userId: 'tg:33', telegramUserId: '33' },
];
vi.mock('./DiscussionsProvider', () => ({
  useDiscussions: () => ({ rows: state.rows, unread: state.unread, loading: false, error: '', retry: vi.fn() }),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: state.db, actorUserId: state.actor, clients: peers, coaches: peers, status: 'ready', syncStatus: 'local',
  }),
}));
vi.mock('../data/cloud/discussion-organization', async importOriginal => ({
  ...await importOriginal<typeof import('../data/cloud/discussion-organization')>(),
  DiscussionOrganizationRepository: class {
    constructor(readonly db: object, readonly actor: string) {}
    observe(threads: Observation['threads'], next: Observation['next'], error: Observation['error']) {
      const unsubscribe = vi.fn();
      state.observers.push({ db: this.db, actor: this.actor, threads, next, error, unsubscribe });
      return { unsubscribe };
    }
    createCategory = state.create;
    renameCategory = state.rename;
    removeCategory = state.remove;
    assignThread = state.assign;
    clearThreadAssignment = state.clear;
  },
}));
vi.mock('../data/cloud/discussions', () => ({
  DiscussionRepository: class { ensureEntityThread = state.ensure; getThread = state.get; },
  observeDiscussionNotificationThread: state.notification,
}));
vi.mock('../contacts/CloudContactAvatar', () => ({
  AVATAR_LOADING_SRC: '',
  CloudContactAvatar: () => <span>Аватар</span>,
  useCloudContactAvatarUrl: () => undefined,
}));
vi.mock('../client/ClientCoachSelectorModal', () => ({ ClientCoachSelectorModal: () => null }));
vi.mock('./DiscussionSheet', () => ({
  DiscussionSheet: ({ threadId, focusMessageId, onBack }: { threadId: string; focusMessageId?: string; onBack: () => void }) =>
    <div role="dialog" aria-label={threadId}><span>{focusMessageId}</span><button onClick={onBack}>Закрыть чат</button></div>,
}));
vi.mock('./DiscussionEntity', () => ({
  DiscussionEntity: ({ thread, onBack }: { thread: DiscussionThread; onBack: () => void }) =>
    <div>{thread.id}<button onClick={onBack}>Назад к списку</button></div>,
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, hidden, value, onValueChange, actionTab }: LiquidGlassTextOnlyProps) => <div role="tablist" hidden={hidden}>
    {tabs.map(tab => <button key={tab.value} role="tab" aria-selected={value === tab.value}
      onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}
    {actionTab ? <button aria-label={actionTab.ariaLabel} onClick={actionTab.onClick}>{actionTab.label}</button> : null}
  </div>,
}));
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    DatePicker: ({ opened, onChange }: { opened: boolean; onChange: (value: string) => void }) =>
      opened ? <button onClick={() => onChange('2026-11-07')}>Выбрать дату</button> : null,
    GlassSurface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
    LiquidGlassIconOnly: ({ tabs, hidden }: LiquidGlassIconOnlyProps) => <div hidden={hidden}>
      {tabs.map(({ label, icon, value }) => <div key={value} role="tab" aria-label={label}>
        {typeof icon === 'object' ? icon.filled : null}
      </div>)}
    </div>,
    LiquidPopover: ({ isOpen, onOpenChange, onPresentationChange, trigger, items, label }: LiquidPopoverProps) => {
      useEffect(() => { onPresentationChange?.(isOpen); }, [isOpen, onPresentationChange]);
      return <>
        <button disabled={trigger.props.disabled} aria-label={label} onClick={() => onOpenChange(!isOpen)} />
        {isOpen ? <div role="menu" aria-label={label}>{items?.map(item =>
          <button key={item.id} role="menuitem" disabled={item.disabled} onClick={() => {
            item.onSelect?.(); onOpenChange(false);
          }}>{item.label}</button>)}</div> : null}
      </>;
    },
  };
});

function custom(number: number, name: string, order: number): CategoryDefinition {
  const id = '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
  if (!isCategoryId(id)) throw Error('Fixture category ID is invalid');
  return { id, name, order };
}
const earlier = custom(2, 'Привычки', 0);
const later = custom(1, 'Реабилитация', 1);
const inCustom = (category: CategoryDefinition): ResolvedDiscussionCategory => ({ kind: 'custom', id: category.id });
function row(label: string, { free = false, older = false, pair = 'pair' } = {}): DiscussionInboxRow {
  const id = free ? 'free-discussion:00000000-0000-4000-8000-000000000001' : label;
  return {
    thread: { ...thread, id, realmId: pair, coachClientId: pair, owner: pair, anchorKey: id,
      anchor: free ? { kind: 'free', threadId: id } : thread.anchor, derivedTitleSnapshot: label },
    latest: { ...message(id, 'Последнее ' + label), createdAt: new Date(2026, 10, older ? 6 : 7, 10).toISOString() },
    unread: 3, hasAttachments: true, contact: peers.find(contact => contact.relationshipId === pair) ?? null,
  };
}
function latestObservation() {
  const observer = state.observers.at(-1);
  if (!observer) throw Error('No organization subscription');
  return observer;
}
function emit(classifications: readonly (readonly [DiscussionInboxRow, ResolvedDiscussionCategory])[] = [],
  categories: CategoryDefinition[] = [], diagnostics: string[] = [], observer = latestObservation()) {
  act(() => observer.next({ categories, diagnostics,
    threads: classifications.map(([row, category]) => ({ thread: row.thread, category,
      ownAssignment: null, peerCategorized: category === 'coach' || category === 'client', diagnostics: [] })) }));
}
function click(name: string, role = 'button') {
  fireEvent.click(screen.getByRole(role, { name }));
}
function threadButton(label: string) {
  return screen.queryByRole('button', { name: new RegExp('^Обсуждение: .+, ' + label + '$') });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const navigation = vi.fn<(value: NavigationContext | null) => void>();

beforeEach(() => {
  state.db = {};
  state.actor = 'tg:11';
  state.rows = [];
  state.unread = 0;
  state.observers = [];
  state.notification.mockReturnValue({ unsubscribe: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('discussion category tabs', () => {
  it.each([
    ['client', 'coach', 'Тренерские', 'тренер вынес'],
    ['coach', 'client', 'Клиентские', 'клиенты вынесли'],
  ] as const)('uses the %s tab order and the local repository projection', (role, peer, label, empty) => {
    const program = row('Программа'), free = row('Свободный чат', { free: true });
    state.rows = [program, free];
    render(<DiscussionsPage role={role} onNavigationContextChange={navigation} />);
    expect(screen.queryByText('Обсуждений пока нет')).toBeNull();
    emit([[program, 'training'], [free, 'personal']], [earlier, later]);
    const tablist = screen.getByRole('tablist');
    expect(within(tablist).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Тренировки', 'Питание', 'Личное', label, earlier.name, later.name,
    ]);
    expect(within(tablist).queryByRole('button', { name: 'Создать категорию' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Управление категориями' })).toBeTruthy();
    expect(threadButton('Программа')).toBeTruthy();
    expect(threadButton('Свободный чат')).toBeNull();
    click('Личное', 'tab');
    expect(threadButton('Программа')).toBeNull();
    expect(threadButton('Свободный чат')).toBeTruthy();
    click(label, 'tab');
    expect(screen.getByText(new RegExp(empty))).toBeTruthy();
    emit([[program, peer], [free, inCustom(later)]], [earlier, later]);
    expect(threadButton('Программа')).toBeTruthy();
    expect(threadButton('Свободный чат')).toBeNull();
    click(later.name, 'tab');
    expect(threadButton('Свободный чат')).toBeTruthy();
    expect(threadButton('Программа')).toBeNull();
  });

  it('reuses the observation for previews and ignores replaced threads, databases and actors', () => {
    const program = row('Первая');
    state.rows = [program];
    const page = (role: 'client' | 'coach') => <StrictMode><DiscussionsPage role={role} onNavigationContextChange={navigation} /></StrictMode>;
    const view = render(page('client'));
    const first = latestObservation();
    emit([[program, inCustom(earlier)]], [earlier]);
    click(earlier.name, 'tab');

    state.rows = [{ ...program, thread: { ...program.thread, lastActivityAt: '2026-11-09T00:00:00.000Z' },
      latest: message('new', 'Обновлённое сообщение'), unread: 4 }];
    view.rerender(page('client'));
    expect(latestObservation()).toBe(first);
    expect(screen.getByText('Обновлённое сообщение')).toBeTruthy();

    const next = row('Вторая');
    state.rows = [next];
    view.rerender(page('client'));
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    emit([[program, 'training']], [], [], first);
    expect(threadButton('Вторая')).toBeNull();
    emit([[next, inCustom(earlier)]], [earlier]);
    expect(threadButton('Вторая')).toBeTruthy();

    const previous = latestObservation();
    state.db = {};
    state.actor = 'tg:54';
    view.rerender(page('coach'));
    expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
    expect(latestObservation()).toMatchObject({ db: state.db, actor: 'tg:54' });
    emit([[next, inCustom(earlier)]], [earlier], [], previous);
    expect(screen.queryByRole('tab', { name: earlier.name })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Тренировки' }).getAttribute('aria-selected')).toBe('true');
    const last = latestObservation();
    view.unmount();
    expect(last.unsubscribe).toHaveBeenCalledTimes(1);
    act(() => last.error(Error('late')));
  });

  it('keeps accessible rows and filters after an organization error, and retries locally', () => {
    const program = row('Видимый'), other = row('Другая пара', { pair: 'other-pair' });
    state.rows = [program, other];
    render(<DiscussionsPage role="coach" relationshipId="pair" onNavigationContextChange={navigation} />);
    const first = latestObservation();
    act(() => first.error(Error('local read failed')));
    expect(screen.getByRole('alert').textContent).toContain('без фильтра по категории');
    expect(threadButton('Видимый')).toBeTruthy();
    expect(threadButton('Другая пара')).toBeNull();
    expect(screen.getByRole('button', { name: 'К программе: Видимый' })).toBeTruthy();
    click('Повторить загрузку категорий');
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    emit([[program, 'nutrition'], [other, 'nutrition']], [], ['CATEGORY_PENDING']);
    click('Питание', 'tab');
    expect(screen.getByText(/Некоторые категории или назначения/)).toBeTruthy();
    expect(threadButton('Видимый')).toBeTruthy();
    expect(threadButton('Другая пара')).toBeNull();
  });

  it('keeps client and date filters when switching tabs and starts pagination at 50', () => {
    const programs = Array.from({ length: 51 }, (_, index) => row('Тренировка ' + index));
    const old = row('Не в периоде', { older: true }), other = row('Чужой фильтр', { pair: 'other-pair' });
    state.rows = [...programs, old, other];
    render(<DiscussionsPage role="coach" onNavigationContextChange={navigation} />);
    emit([...programs.map(program => [program, 'training'] as const), [old, 'nutrition'], [other, 'nutrition']]);
    click('Поиск клиента');
    click('Выбрать клиента Анна');
    click('Применить фильтр');
    click('С даты');
    click('Выбрать дату');
    click('Показать ещё');
    expect(threadButton('Тренировка 50')).toBeTruthy();
    click('Питание', 'tab');
    expect(threadButton('Не в периоде')).toBeNull();
    expect(threadButton('Чужой фильтр')).toBeNull();
    click('Тренировки', 'tab');
    expect(threadButton('Тренировка 50')).toBeNull();
    expect(screen.getByRole('button', { name: 'Показать ещё' })).toBeTruthy();
  });
});

describe('category actions', () => {
  it('validates an empty input, keeps failed names editable, and activates one successful new category', async () => {
    const creation = deferred<CategoryDefinition>();
    state.create.mockRejectedValueOnce(new Error('DUPLICATE_DISCUSSION_CATEGORY_NAME')).mockReturnValueOnce(creation.promise);
    render(<StrictMode><DiscussionsPage role="client" onNavigationContextChange={navigation} /></StrictMode>);
    emit();
    click('Управление категориями');
    click('Добавить категорию', 'menuitem');
    const dialog = screen.getByRole('dialog', { name: 'Новая категория' });
    const create = within(dialog).getByRole('button', { name: 'Создать' });
    const name = within(dialog).getByLabelText('Название');
    expect(screen.getByRole('tab', { name: 'Тренировки' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(create);
    expect(within(dialog).getByRole('alert').textContent).toBe('Введите название категории.');
    expect(state.create).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: '  Реабилитация  ' } });
    fireEvent.click(create);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('таким названием');
    expect(state.create).toHaveBeenLastCalledWith('Реабилитация');

    act(() => { fireEvent.click(create); fireEvent.click(create); });
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toHaveProperty('disabled', true);
    act(() => navigation.mock.lastCall?.[0]?.onBack?.());
    expect(screen.getByRole('dialog', { name: 'Новая категория' })).toBeTruthy();
    await act(async () => creation.resolve(later));
    emit([], [later]);
    expect(screen.queryByRole('dialog', { name: 'Новая категория' })).toBeNull();
    expect(screen.getByRole('tab', { name: later.name }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tablist')).queryByRole('button', { name: 'Создать категорию' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Управление категориями' })).toBeTruthy();
  });

  it('renames the active category and confirms removal without deleting the conversation', async () => {
    const chat = row('История', { free: true });
    state.rows = [chat];
    state.rename.mockResolvedValue(undefined);
    state.remove.mockResolvedValue(undefined);
    render(<DiscussionsPage role="client" onNavigationContextChange={navigation} />);
    emit([[chat, inCustom(earlier)]], [earlier]);
    click(earlier.name, 'tab');
    click('Управление категориями');
    click('Переименовать категорию', 'menuitem');
    expect(screen.getByLabelText('Название')).toHaveProperty('value', earlier.name);
    const renamed = { ...earlier, name: 'Новый раздел' };
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: renamed.name } });
    await act(async () => click('Сохранить'));
    expect(state.rename).toHaveBeenCalledWith(earlier.id, renamed.name);
    emit([[chat, inCustom(renamed)]], [renamed]);
    expect(screen.queryByRole('tab', { name: earlier.name })).toBeNull();
    expect(threadButton('История')).toBeTruthy();
    click('Управление категориями');
    click('Удалить категорию', 'menuitem');
    expect(screen.getByRole('alertdialog', { name: 'Удалить категорию?' }).textContent).toContain('Чаты и сообщения сохранятся');
    await act(async () => click('Удалить'));
    expect(state.remove).toHaveBeenCalledWith(renamed.id);
    emit([[chat, 'personal']]);
    expect(screen.getByRole('tab', { name: 'Личное' }).getAttribute('aria-selected')).toBe('true');
    expect(threadButton('История')).toBeTruthy();
  });

  it('moves the exact saved thread, handles refusal, and retains the independent entity action', async () => {
    const program = row('Силовая'), free = row('Заметки', { free: true });
    state.rows = [program, free];
    state.assign.mockRejectedValueOnce(new Error('DISCUSSION_CATEGORY_NOT_FOUND')).mockResolvedValue(undefined);
    state.clear.mockResolvedValue(undefined);
    render(<DiscussionsPage role="client" onNavigationContextChange={navigation} />);
    emit([[program, 'training'], [free, 'personal']], [earlier]);
    click('К программе: Силовая');
    expect(state.ensure).not.toHaveBeenCalled();
    click('Назад к списку');
    click('Переместить в категорию: Силовая');
    expect(screen.queryByRole('menuitem', { name: 'Тренерские' })).toBeNull();
    await act(async () => click(earlier.name, 'menuitem'));
    expect(state.assign).toHaveBeenCalledWith(program.thread, inCustom(earlier));
    expect(state.assign.mock.calls[0][0]).toBe(program.thread);
    expect(screen.getByRole('alert').textContent).toBe('Эта категория больше недоступна.');
    expect(threadButton('Силовая')).toBeTruthy();

    click('Переместить в категорию: Силовая');
    await act(async () => click('Питание', 'menuitem'));
    emit([[program, 'nutrition'], [free, 'personal']], [earlier]);
    expect(threadButton('Силовая')).toBeNull();
    click('Питание', 'tab');
    click('Переместить в категорию: Силовая');
    await act(async () => click('Тренировки', 'menuitem'));
    expect(state.clear.mock.calls[0][0]).toBe(program.thread);

    click('Личное', 'tab');
    expect(screen.queryByRole('button', { name: /^К / })).toBeNull();
    click('Переместить в категорию: Заметки');
    await act(async () => click(earlier.name, 'menuitem'));
    emit([[program, 'training'], [free, inCustom(earlier)]], [earlier]);
    click(earlier.name, 'tab');
    expect(screen.getByLabelText('Есть вложения')).toBeTruthy();
    expect(screen.getByLabelText('Непрочитанных: 3')).toBeTruthy();
    click('Переместить в категорию: Заметки');
    expect(screen.queryByRole('menuitem', { name: 'Тренировки' })).toBeNull();
    await act(async () => click('Без категории / по умолчанию', 'menuitem'));
    expect(state.clear.mock.calls[1][0]).toBe(free.thread);
  });

  it('ignores a pending category creation after changing identity and cancels obsolete row opening', async () => {
    const program = row('Программа');
    state.rows = [program];
    const opening = deferred<DiscussionThread>();
    state.ensure.mockReturnValue(opening.promise);
    const creating = deferred<CategoryDefinition>();
    state.create.mockReturnValue(creating.promise);
    const page = <DiscussionsPage role="client" onNavigationContextChange={navigation} />;
    const view = render(page);
    emit([[program, 'training']]);
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждение: Анна, Программа' }));
    click('Личное', 'tab');
    await act(async () => opening.resolve(program.thread));
    expect(screen.queryByRole('dialog')).toBeNull();
    click('Управление категориями');
    click('Добавить категорию', 'menuitem');
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: later.name } });
    click('Создать');
    state.actor = 'tg:41';
    view.rerender(<DiscussionsPage role="client" onNavigationContextChange={navigation} />);
    const observer = latestObservation();
    await act(async () => creating.resolve(later));
    expect(latestObservation()).toBe(observer);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('tab', { name: later.name })).toBeNull();
  });

  it('keeps the Telegram deep link independent of the tabs and dismisses a covered category dialog', () => {
    const free = row('История', { free: true });
    const consumed = vi.fn();
    render(<DiscussionsPage role="client" notificationMessageId="exact-message"
      onNotificationOpened={consumed} onNavigationContextChange={navigation} />);
    emit();
    click('Питание', 'tab');
    click('Управление категориями');
    click('Добавить категорию', 'menuitem');
    expect(consumed).not.toHaveBeenCalled();
    const resolveNotification = state.notification.mock.calls[0][4] as (thread: DiscussionThread) => void;
    act(() => resolveNotification(free.thread));
    const chat = screen.getByRole('dialog', { name: free.thread.id });
    expect(within(chat).getByText('exact-message')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Новая категория' })).toBeNull();
    expect(consumed).toHaveBeenCalledTimes(1);
    click('Закрыть чат');
    expect(screen.getByRole('tab', { name: 'Питание' }).getAttribute('aria-selected')).toBe('true');
  });

  it('does not change the shell unread count when the selected tab has fewer unread messages', () => {
    const training = row('Программа'), personal = row('Чат', { free: true });
    state.rows = [training, { ...personal, unread: 5 }];
    state.unread = 8;
    const me = { user: { id: 11, telegramUserId: '11', username: null, firstName: 'Тест', lastName: null,
      languageCode: 'ru', photoUrl: null, isPremium: false }, roles: ['client' as const] };
    render(<NavigationShell me={me} activeRole="client" destination="discussions" context={null}
      onDestinationChange={vi.fn()} onRoleSwitch={vi.fn()}>
      <DiscussionsPage role="client" onNavigationContextChange={navigation} />
    </NavigationShell>);
    emit([[training, 'training'], [personal, 'personal']]);
    const badge = () => within(screen.getByRole('tab', { name: 'Обсуждения' })).getByText('8');
    expect(badge()).toBeTruthy();
    expect(screen.getByLabelText('Непрочитанных: 3')).toBeTruthy();
    click('Личное', 'tab');
    expect(badge()).toBeTruthy();
    expect(screen.getByLabelText('Непрочитанных: 5')).toBeTruthy();
  });
});
