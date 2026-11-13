// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscussionsPage } from './DiscussionsPage';
import { thread } from './discussion-fixture.test-support';

const state = vi.hoisted(() => ({
  db: {},
  observe: vi.fn(),
  retrySync: vi.fn(),
  subscriptions: [] as Array<{
    next: (value: unknown) => void;
    error: (reason: unknown) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
    allowedRealms: ReadonlySet<string>;
  }>,
}));
vi.mock('./DiscussionsProvider', () => ({
  useDiscussions: () => ({ rows: [], unread: 0, loading: false, error: '', retry: vi.fn() }),
}));
vi.mock('../navigation/NavigationSurfaceContext', () => ({ useNavigationSurfaceContext: () => null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: state.db, actorUserId: 'tg:11', clients: [
      { relationshipId: 'pair', userId: 'tg:22', displayName: 'Анна', telegramUserId: '22' },
    ],
    status: 'ready', syncStatus: 'synced', retrySync: state.retrySync,
  }),
}));
vi.mock('../contacts/CloudContactAvatar', () => ({
  CloudContactAvatar: () => <span>Аватар</span>,
}));
vi.mock('../data/cloud/discussions', () => ({
  DiscussionRepository: class {},
  observeDiscussionNotificationThread: state.observe,
}));
vi.mock('./DiscussionSheet', () => ({
  DiscussionSheet: ({ threadId }: { threadId: string }) => <div role="dialog" aria-label={threadId} />,
}));
vi.mock('./DiscussionEntity', () => ({
  DiscussionEntity: () => <div>Сущность обсуждения</div>,
}));
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    DatePicker: () => null,
  };
});

const target = { ...thread, id: 'notification-thread', realmId: 'pair', coachClientId: 'pair' };

beforeEach(() => {
  state.subscriptions = [];
  state.retrySync.mockResolvedValue(undefined);
  state.observe.mockImplementation((
    _db: unknown, _actor: string, _id: string, allowedRealms: ReadonlySet<string>,
    next: (value: unknown) => void, error: (reason: unknown) => void,
  ) => {
    const unsubscribe = vi.fn();
    state.subscriptions.push({ next, error, unsubscribe, allowedRealms });
    return { unsubscribe };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.observe.mockReset();
  state.retrySync.mockReset();
});

describe('Telegram discussion deep-link hydration', () => {
  it('waits for the exact authorized message even after sync reports synced', () => {
    const consumed = vi.fn();
    render(<DiscussionsPage role="coach" notificationMessageId="message-1"
      onNotificationOpened={consumed} onNavigationContextChange={vi.fn()} />);
    expect(screen.getByText('Загружаем обсуждение по ссылке…')).toBeTruthy();
    expect([...state.subscriptions[0].allowedRealms]).toEqual(['pair']);
    act(() => state.subscriptions[0].next(null));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
    act(() => state.subscriptions[0].next(target));
    expect(screen.getByRole('dialog', { name: target.id })).toBeTruthy();
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(state.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps watching after a slow pull and offers an explicit sync retry', () => {
    vi.useFakeTimers();
    const consumed = vi.fn();
    render(<DiscussionsPage role="coach" notificationMessageId="message-1"
      onNotificationOpened={consumed} onNavigationContextChange={vi.fn()} />);
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert').textContent).toContain('Обсуждение пока не загрузилось');
    expect(consumed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(state.retrySync).toHaveBeenCalledTimes(1);
    expect(state.subscriptions).toHaveLength(2);
    act(() => state.subscriptions[0].next(target));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => state.subscriptions[1].next(target));
    expect(screen.getByRole('dialog', { name: target.id })).toBeTruthy();
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('recovers from temporary observer failures and cancels retries on unmount', () => {
    vi.useFakeTimers();
    const view = render(<DiscussionsPage role="coach" notificationMessageId="message-1"
      onNotificationOpened={vi.fn()} onNavigationContextChange={vi.fn()} />);
    act(() => state.subscriptions[0].error(new Error('database temporarily unavailable')));
    act(() => vi.advanceTimersByTime(1_000));
    expect(state.subscriptions).toHaveLength(2);
    act(() => state.subscriptions[1].error(new Error('database temporarily unavailable')));
    act(() => vi.advanceTimersByTime(2_000));
    expect(state.subscriptions).toHaveLength(3);
    act(() => state.subscriptions[2].error(new Error('database temporarily unavailable')));
    expect(screen.getByRole('alert').textContent).toContain('Не удалось загрузить обсуждение');
    view.unmount();
    act(() => vi.advanceTimersByTime(20_000));
    expect(state.subscriptions).toHaveLength(3);
    expect(state.subscriptions[2].unsubscribe).toHaveBeenCalled();
  });
});
