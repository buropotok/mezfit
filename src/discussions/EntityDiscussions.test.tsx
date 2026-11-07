// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import type { DiscussionRepository } from '../data/cloud/discussions';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import { NavigationSurfaceContext } from '../navigation/NavigationSurfaceContext';
import { useEntityDiscussions } from './useEntityDiscussions';
import { fixture, thread } from './discussion-fixture.test-support';
import type { EntityDiscussionTarget } from './entity-discussion-target';

const probe = vi.hoisted(() => ({ repository: null as unknown as DiscussionRepository,
  db: {}, actorUserId: 'tg:1', initializationError: false }));
vi.mock('../data/cloud/discussion-activation', () => ({ CLOUD_DISCUSSIONS_ENABLED: true }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: probe.db, actorUserId: probe.actorUserId, clients: [], coaches: [],
}) }));
vi.mock('../data/cloud/discussions', async original => ({
  ...await original<typeof import('../data/cloud/discussions')>(),
  DiscussionRepository: class { constructor() {
    if (probe.initializationError) throw Error('DISCUSSIONS_NOT_ENABLED');
    return probe.repository;
  } },
}));
const target: EntityDiscussionTarget = { scope: { realmId: 'pair', coachClientId: 'pair' },
  anchor: thread.anchor, name: 'Силовая' };
type AnchorValue = { threads: DiscussionThread[]; unread: number; unreadByThread: Record<string, number> };
let emit: (value: AnchorValue) => void;
let fail: (reason: unknown) => void;
let unsubscribe = vi.fn<() => void>();
let ensureThread: ReturnType<typeof vi.fn<DiscussionRepository['ensureEntityThread']>>;
beforeEach(() => {
  probe.db = {}; probe.initializationError = false;
  const f = fixture();
  unsubscribe = vi.fn<() => void>(); ensureThread = vi.fn<DiscussionRepository['ensureEntityThread']>(async () => thread);
  probe.repository = { ...f.port, ensureEntityThread: ensureThread,
    observeAnchor: vi.fn<DiscussionRepository['observeAnchor']>((_anchor, next, error) => {
      emit = next; fail = error;
      next({ threads: [thread], unread: 3, unreadByThread: { thread: 3 } });
      return { unsubscribe };
    }),
  } as unknown as DiscussionRepository;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(initial: EntityDiscussionTarget | null = target) {
  let navigation: NavigationContext | null = null;
  const onNavigation = vi.fn((value: NavigationContext | null) => { navigation = value; });
  const parent = { level: 1 as const, title: 'Программа', scrollKey: 'exact-program', onBack: vi.fn() };
  function Harness({ source }: { source: EntityDiscussionTarget | null }) {
    const [filter, setFilter] = useState('Активные');
    const discussion = useEntityDiscussions(source, onNavigation);
    return <><input aria-label="Фильтр" value={filter} onChange={event => setFilter(event.target.value)} />
      <output aria-label="Непрочитанные сущности">{discussion.unread}</output>
      <button onClick={() => { discussion.menuItem.onSelect?.(); discussion.onMenuPresentationChange(false); }}>Обсуждения</button>
      {discussion.content}</>;
  }
  const page = (source: EntityDiscussionTarget | null) => <KonstaProvider theme="ios" dark>
    <NavigationSurfaceContext.Provider value={parent}><Harness source={source} /></NavigationSurfaceContext.Provider>
  </KonstaProvider>;
  const view = render(page(initial));
  return { ...view, onNavigation, parent, back: () => act(() => navigation?.onBack?.()),
    source: (source: EntityDiscussionTarget | null) => view.rerender(page(source)),
    account: () => { probe.db = {}; view.rerender(page(initial)); } };
}

describe('COMM-06 direct entity conversation', () => {
  it('opens immediately, preserves filters and source scroll identity, and Back closes directly', async () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Фильтр'), { target: { value: 'Ноги' } });
    fireEvent.click(screen.getByText('Обсуждения'));
    expect(await screen.findByText('Мой текст')).toBeTruthy();
    expect(ensureThread).toHaveBeenCalledWith(target.anchor, target.name);
    expect(screen.queryByText('Создать обсуждение')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Силовая' })).toBeNull();
    expect(view.onNavigation).toHaveBeenLastCalledWith(expect.objectContaining({ level: 2, scrollKey: 'exact-program' }));
    view.back();
    await waitFor(() => expect(screen.queryByText('Мой текст')).toBeNull());
    expect(view.onNavigation).toHaveBeenLastCalledWith(null);
    expect((screen.getByLabelText('Фильтр') as HTMLInputElement).value).toBe('Ноги');
    expect(view.parent.onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Обсуждения'));
    await screen.findByText('Мой текст');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));
    await waitFor(() => expect(screen.queryByText('Мой текст')).toBeNull());
  });
  it('retries automatic opening and ignores completion after closing', async () => {
    ensureThread.mockRejectedValueOnce(Error('Local failure'));
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    await screen.findByText('Не удалось открыть обсуждение');
    let resolve: ((value: DiscussionThread) => void) | undefined;
    ensureThread.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByText('Повторить'));
    expect(ensureThread).toHaveBeenCalledTimes(2);
    view.back();
    await act(async () => { resolve?.(thread); });
    expect(screen.queryByText('Мой текст')).toBeNull();
  });
  it('retains open history on source deletion and rejects late old-scope results', async () => {
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    await screen.findByText('Мой текст');
    view.source(null);
    expect(screen.getByText('Мой текст')).toBeTruthy();
    const old = emit;
    view.source({ ...target, scope: { realmId: 'pair-b', coachClientId: 'pair-b' } });
    expect(unsubscribe).toHaveBeenCalled();
    act(() => old({ threads: [], unread: 99, unreadByThread: {} }));
    expect(screen.getByLabelText('Непрочитанные сущности').textContent).toBe('3');
    expect(screen.queryByText('Мой текст')).toBeNull();
  });
  it('keeps the source usable after repository initialization fails and retries in the overlay', async () => {
    probe.initializationError = true;
    const view = mount();
    fireEvent.change(screen.getByLabelText('Фильтр'), { target: { value: 'Ноги' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('Обсуждения'));
    expect(await screen.findByText('Не удалось подключить обсуждение')).toBeTruthy();
    expect(ensureThread).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Фильтр') as HTMLInputElement).value).toBe('Ноги');
    probe.initializationError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('Мой текст');
    view.back();
    await waitFor(() => expect(screen.queryByText('Мой текст')).toBeNull());
    expect((screen.getByLabelText('Фильтр') as HTMLInputElement).value).toBe('Ноги');
  });
  it('clears stale unread on observer failure', () => {
    mount();
    act(() => fail(Error('Access/query failure')));
    expect(screen.getByLabelText('Непрочитанные сущности').textContent).toBe('0');
  });
  it('dismisses the old account overlay and ignores late automatic creation', async () => {
    let resolve: ((value: DiscussionThread) => void) | undefined;
    ensureThread.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    view.account();
    await act(async () => { resolve?.(thread); });
    expect(screen.queryByText('Мой текст')).toBeNull();
    expect(view.onNavigation).toHaveBeenLastCalledWith(null);
  });
});
