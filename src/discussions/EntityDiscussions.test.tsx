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
  db: {}, actorUserId: 'tg:1' }));
vi.mock('../data/cloud/discussion-activation', () => ({ CLOUD_DISCUSSIONS_ENABLED: true }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: probe.db, actorUserId: probe.actorUserId, clients: [], coaches: [],
}) }));
vi.mock('../data/cloud/discussions', async original => ({
  ...await original<typeof import('../data/cloud/discussions')>(),
  DiscussionRepository: class { constructor() { return probe.repository; } },
}));
const target: EntityDiscussionTarget = { scope: { realmId: 'pair', coachClientId: 'pair' },
  anchor: thread.anchor, name: 'Силовая' };
type AnchorValue = { threads: DiscussionThread[]; unread: number; unreadByThread: Record<string, number> };
let emit: (value: AnchorValue) => void;
let fail: (reason: unknown) => void;
let unsubscribe = vi.fn<() => void>();
let createThread: ReturnType<typeof vi.fn<DiscussionRepository['createThread']>>;
beforeEach(() => {
  probe.db = {};
  const f = fixture();
  unsubscribe = vi.fn<() => void>(); createThread = vi.fn<DiscussionRepository['createThread']>(async () => thread);
  probe.repository = { ...f.port, createThread,
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
  const parent = { title: 'Программа', scrollKey: 'exact-program', onBack: vi.fn() };
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

describe('COMM-06 entity thread overlay', () => {
  it('lists only thread titles and unread, opens the exact thread and preserves filters and source scroll identity through Back', async () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Фильтр'), { target: { value: 'Ноги' } });
    fireEvent.click(screen.getByText('Обсуждения'));
    expect(screen.getByText(thread.derivedTitleSnapshot)).toBeTruthy();
    expect(screen.queryByText('Мой текст')).toBeNull();
    expect(view.onNavigation).toHaveBeenLastCalledWith(expect.objectContaining({ scrollKey: 'exact-program' }));
    fireEvent.click(screen.getByText(thread.derivedTitleSnapshot));
    expect(await screen.findByText('Мой текст')).toBeTruthy();
    expect(probe.repository.listThreads).toHaveBeenCalledWith(target.anchor);
    view.back();
    await waitFor(() => expect(screen.queryByText('Мой текст')).toBeNull());
    view.back();
    expect(screen.queryByRole('button', { name: 'Закрыть обсуждения' })).toBeNull();
    expect((screen.getByLabelText('Фильтр') as HTMLInputElement).value).toBe('Ноги');
    expect(view.parent.onBack).not.toHaveBeenCalled();
  });
  it('returns directly to the source from the chat callback and clears the overlay Back handler', async () => {
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    fireEvent.click(screen.getByText(thread.derivedTitleSnapshot));
    await screen.findByText('Мой текст');
    fireEvent.click(screen.getByRole('button', { name: 'Силовая' }));
    await waitFor(() => expect(screen.queryByText('Мой текст')).toBeNull());
    expect(view.onNavigation).toHaveBeenLastCalledWith(null);
  });
  it('retries the same create command, blocks duplicate taps, and ignores completion after closing', async () => {
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    createThread.mockRejectedValueOnce(Error('Local failure'));
    fireEvent.click(screen.getByText('Создать обсуждение'));
    await screen.findByText('Не удалось создать обсуждение');
    const first = createThread.mock.calls[0][0];
    expect(first).toMatchObject({ anchor: target.anchor, entityName: 'Силовая', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    fireEvent.click(screen.getByText('Повторить'));
    await screen.findByText('Создать обсуждение');
    let resolve: ((value: DiscussionThread) => void) | undefined;
    createThread.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByText('Создать обсуждение'));
    fireEvent.click(screen.getByText('Создаём…'));
    expect(createThread).toHaveBeenCalledTimes(2);
    expect(createThread.mock.calls[1][0]).toEqual(first);
    view.back();
    await act(async () => { resolve?.(thread); });
    expect(screen.queryByText('Мой текст')).toBeNull();
  });
  it('retains historical titles after source deletion, disables new threads and rejects late old-scope observer results', () => {
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    view.source(null);
    expect(screen.getByText(/Исходный объект недоступен/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Создать обсуждение' }) as HTMLButtonElement).disabled).toBe(true);
    const old = emit;
    view.source({ ...target, scope: { realmId: 'pair-b', coachClientId: 'pair-b' } });
    expect(unsubscribe).toHaveBeenCalled();
    act(() => old({ threads: [], unread: 99, unreadByThread: {} }));
    expect(screen.getByLabelText('Непрочитанные сущности').textContent).toBe('3');
  });
  it('clears stale unread on observer failure and exposes a working retry without changing the source', async () => {
    mount(); fireEvent.click(screen.getByText('Обсуждения'));
    act(() => fail(Error('Access/query failure')));
    expect(screen.getByLabelText('Непрочитанные сущности').textContent).toBe('0');
    fireEvent.click(screen.getByText('Повторить'));
    await screen.findByText(thread.derivedTitleSnapshot);
    expect(screen.getByLabelText('Непрочитанные сущности').textContent).toBe('3');
  });
  it('dismisses the old account overlay and ignores its late create completion', async () => {
    const view = mount(); fireEvent.click(screen.getByText('Обсуждения'));
    let resolve: ((value: DiscussionThread) => void) | undefined;
    createThread.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByText('Создать обсуждение'));
    view.account();
    expect(screen.queryByText(thread.derivedTitleSnapshot)).toBeNull();
    await act(async () => { resolve?.(thread); });
    expect(screen.queryByText('Мой текст')).toBeNull();
    expect(view.onNavigation).toHaveBeenLastCalledWith(null);
  });
});
