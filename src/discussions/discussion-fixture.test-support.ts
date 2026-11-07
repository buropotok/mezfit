import { vi } from 'vitest';
import type { DiscussionMessageInput, DiscussionPage } from '../data/cloud/discussions';
import type { DiscussionMessageView, DiscussionCursor } from '../data/cloud/discussion-views';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import type { DiscussionSyncState } from '../data/cloud/discussion-sync';
import type { DiscussionPort } from './discussion-session';

export const anchor = { kind: 'program' as const, trainingPlanId: 'plan' };
export const thread: DiscussionThread = { id: 'thread', realmId: 'pair', coachClientId: 'pair', owner: 'pair', anchor,
  anchorKey: '["pair","pair","program","plan"]', contextPath: [], derivedTitleSnapshot: 'Программа · 2026-11-07',
  createdAt: '2026-11-07T00:00:00.000Z', lastActivityAt: '2026-11-07T00:00:00.000Z' };
export function message(id: string, text = id, authorUserId = 'tg:1', offset = 0): DiscussionMessageView {
  return { id, text, authorUserId, threadId: thread.id, deleted: false, reply: null,
    createdAt: new Date(Date.parse(thread.createdAt) + offset * 1000).toISOString() };
}
export function fixture(initial: DiscussionMessageView[] = [message('own', 'Мой текст'), message('other', 'Чужой текст', 'tg:2', 1)]) {
  let rows = initial;
  const observers = new Set<{ next: (page: DiscussionPage) => void; error: (reason: unknown) => void; before?: DiscussionCursor; limit: number }>();
  const slice = (before?: DiscussionCursor, limit = 40): DiscussionPage => {
    const matches = rows.filter(row => !before || row.createdAt < before.createdAt || (row.createdAt === before.createdAt && row.id < before.id));
    const messages = matches.slice(-limit), oldest = messages[0];
    return { messages, before: oldest && matches.length > limit ? { id: oldest.id, createdAt: oldest.createdAt } : null };
  };
  const port: DiscussionPort = {
    actorUserId: 'tg:1',
    getDraft: vi.fn(async () => null),
    saveDraft: vi.fn(async (_input: DiscussionMessageInput) => {}),
    listThreads: vi.fn(async () => [thread]),
    page: vi.fn(async (_thread: string, before?: DiscussionCursor, limit?: number) => slice(before, limit)),
    getMessage: vi.fn(async (_thread: string, id: string) => {
      const row = rows.find(row => row.id === id); if (!row) throw Error('Not found'); return row;
    }),
    observePage: vi.fn((_thread: string, next: (page: DiscussionPage) => void, error: (reason: unknown) => void, before?: DiscussionCursor, limit = 40) => {
      const observer = { next, error, before, limit }; observers.add(observer);
      queueMicrotask(() => { if (observers.has(observer)) next(slice(before, limit)); });
      return { unsubscribe: () => { observers.delete(observer); } };
    }),
    send: vi.fn(async (input: DiscussionMessageInput) => ({ ...message(input.id, input.text), threadId: input.threadId })),
    edit: vi.fn(async (_thread: string, _id: string, _text: string) => {}),
    remove: vi.fn(async (_thread: string, _id: string) => {}),
    markRead: vi.fn(async (_thread: string, _id: string) => {}),
    sync: { retry: vi.fn(async () => {}), observe: vi.fn((next: (state: DiscussionSyncState) => void) => {
      next({ status: 'local', offline: true, error: null }); return { unsubscribe: vi.fn() };
    }) },
  };
  return { port, observers, replace(next: DiscussionMessageView[]) {
    rows = next;
    for (const observer of [...observers]) if (observers.has(observer)) observer.next(slice(observer.before, observer.limit));
  }, fail() { for (const observer of [...observers]) observer.error(Error('Unavailable')); } };
}

