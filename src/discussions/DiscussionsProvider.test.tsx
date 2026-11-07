// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionScope } from '../data/cloud/discussion-contracts';
import type { DiscussionFeedRow } from '../data/cloud/discussions';
import { DiscussionsProvider, useDiscussions } from './DiscussionsProvider';
import { thread } from './discussion-fixture.test-support';

const state = vi.hoisted(() => ({ feed: vi.fn(), clients: [] as Array<{ relationshipId: string; displayName: string }>,
  coaches: [{ relationshipId: 'pair-a', displayName: 'Первый тренер' }, { relationshipId: 'pair-b', displayName: 'Второй тренер' }] }));
const initialCoaches = state.coaches;
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: database, actorUserId: 'tg:22', clients: state.clients, coaches: state.coaches, status: 'ready',
}) }));
vi.mock('../data/cloud/discussions', () => ({ DiscussionRepository: class {
  constructor(_db: unknown, _actor: string, private scope: DiscussionScope) {}
  feed(attachments: unknown, latest: boolean) { return state.feed(this.scope, attachments, latest); }
} }));
const database = {};
function Consumer() {
  const inbox = useDiscussions();
  return <><output aria-label="Непрочитанные">{inbox.unread}</output>
    <output aria-label="Загрузка">{String(inbox.loading)}</output>
    <output aria-label="Ошибка">{inbox.error}</output>
    <output aria-label="Собеседники">{inbox.rows.map(row => row.contact?.displayName).filter(Boolean).join(', ')}</output></>;
}
afterEach(() => { cleanup(); state.feed.mockReset(); state.clients = []; state.coaches = initialCoaches; });

it('sums unread across both coaches once and changes the role-scoped subset without a selected-coach dependency', async () => {
  state.feed.mockImplementation(async (scope: DiscussionScope): Promise<DiscussionFeedRow[]> => [{
    thread: { ...thread, id: scope.realmId, realmId: scope.realmId, coachClientId: scope.coachClientId },
    latest: null, unread: scope.realmId === 'pair-a' ? 2 : scope.realmId === 'pair-b' ? 3 : 0, hasAttachments: false,
  }]);
  const view = render(<DiscussionsProvider role="client"><Consumer /></DiscussionsProvider>);
  await waitFor(() => expect(screen.getByLabelText('Непрочитанные').textContent).toBe('5'));
  expect(screen.getByLabelText('Собеседники').textContent).toBe('Первый тренер, Второй тренер');
  view.rerender(<DiscussionsProvider role="coach"><Consumer /></DiscussionsProvider>);
  await waitFor(() => expect(screen.getByLabelText('Непрочитанные').textContent).toBe('0'));
  expect(screen.getByLabelText('Собеседники').textContent).toBe('');
});

it('requests only unread metadata outside discussion screens', async () => {
  state.feed.mockResolvedValue([]);
  render(<DiscussionsProvider role="client" details={false}><Consumer /></DiscussionsProvider>);
  await waitFor(() => expect(state.feed).toHaveBeenCalledTimes(3));
  for (const call of state.feed.mock.calls) expect(call.slice(1)).toEqual([undefined, false]);
});

it('updates contact presentation without clearing unread or restarting the conversation observer', async () => {
  state.feed.mockImplementation(async (scope: DiscussionScope): Promise<DiscussionFeedRow[]> => [{
    thread: { ...thread, id: scope.realmId, realmId: scope.realmId, coachClientId: scope.coachClientId },
    latest: null, unread: scope.realmId === 'pair-a' ? 2 : 0, hasAttachments: false,
  }]);
  const view = render(<DiscussionsProvider role="client"><Consumer /></DiscussionsProvider>);
  await waitFor(() => expect(screen.getByLabelText('Непрочитанные').textContent).toBe('2'));
  const queries = state.feed.mock.calls.length;
  state.coaches = state.coaches.map(coach => ({ ...coach, displayName: 'Обновлено: ' + coach.displayName }));
  view.rerender(<DiscussionsProvider role="client"><Consumer /></DiscussionsProvider>);
  expect(screen.getByLabelText('Непрочитанные').textContent).toBe('2');
  expect(screen.getByLabelText('Загрузка').textContent).toBe('false');
  expect(screen.getByLabelText('Собеседники').textContent).toContain('Обновлено: Первый тренер');
  expect(state.feed).toHaveBeenCalledTimes(queries);
});

it('excludes a revoked relationship without hiding another coach conversation', async () => {
  state.feed.mockImplementation(async (scope: DiscussionScope): Promise<DiscussionFeedRow[]> => {
    if (scope.realmId === 'pair-a') throw Error('DISCUSSION_ACCESS_DENIED');
    return [{ thread: { ...thread, id: scope.realmId, realmId: scope.realmId, coachClientId: scope.coachClientId },
      latest: null, unread: scope.realmId === 'pair-b' ? 3 : 0, hasAttachments: false }];
  });
  render(<DiscussionsProvider role="client"><Consumer /></DiscussionsProvider>);
  await waitFor(() => expect(screen.getByLabelText('Непрочитанные').textContent).toBe('3'));
  expect(screen.getByLabelText('Собеседники').textContent).toBe('Второй тренер');
  expect(screen.getByLabelText('Ошибка').textContent).toBe('');
});
