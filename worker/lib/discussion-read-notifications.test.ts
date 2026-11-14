import { afterEach, describe, expect, it, vi } from 'vitest';
import { discussionReadStateId } from '../../shared/discussion-read-state';
import { relationshipMembership } from './dexie-cloud-membership';
import { receiveDiscussionNotifications } from './discussion-notifications';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Telegram discussion read grace period', () => {
  it.each([
    ['client', 'read', false],
    ['coach', 'read', false],
    ['client', 'older', true],
    ['coach', 'wrong-owner', true],
  ] as const)('handles a %s publication with a %s cursor', async (author, cursor, queued) => {
    const { realm, members } = await relationshipMembership('456', '123');
    const batch = vi.fn(async () => []);
    const bind = vi.fn(() => ({ all: async () => ({ results: [] }) }));
    const prepare = vi.fn(() => ({ bind }));
    const env = {
      DB_BINDING: { batch, prepare } as unknown as D1Database,
      DEXIE_DISCUSSION_WEBHOOK_SECRET: 'test-secret',
      DEXIE_CLOUD_REMINDER_CLIENT_ID: 'test-id',
      DEXIE_CLOUD_REMINDER_CLIENT_SECRET: 'test-secret',
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      TELEGRAM_BOT_USERNAME: 'mezfit_bot',
    };
    const createdAt = '2026-11-14T10:00:00.000Z';
    const messageId = 'message-2';
    const threadId = 'thread-1';
    const authorId = author === 'client' ? 'tg:123' : 'tg:456';
    const recipient = author === 'client' ? 'tg:456' : 'tg:123';
    const stateId = discussionReadStateId(realm.realmId, threadId, recipient);
    const fetchCloud = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/token') return Response.json({ type: 'tokens', accessToken: 'read-token' });
      if (url.pathname === '/all/members') return Response.json(members);
      if (url.pathname === '/all/realms/' + realm.realmId) return Response.json(realm);
      if (url.pathname === '/all/discussionMessages/' + messageId) {
        return Response.json({ id: messageId, realmId: realm.realmId, threadId, authorUserId: authorId,
          owner: authorId, createdAt });
      }
      if (decodeURIComponent(url.pathname) === '/all/discussionReadStates/' + stateId) {
        const lastReadMessageId = cursor === 'older' ? 'message-1' : messageId;
        return Response.json({ id: stateId, realmId: realm.realmId, threadId, userId: recipient,
          owner: cursor === 'wrong-owner' ? authorId : recipient,
          lastReadMessageId, readThrough: createdAt + '/' + lastReadMessageId });
      }
      throw new Error('Unexpected cloud request');
    });
    vi.stubGlobal('fetch', fetchCloud);
    const request = new Request('https://example.com/api/webhooks/dexie-discussions', {
      method: 'POST',
      headers: { 'X-DexieCloud-Token': 'test-secret' },
      body: JSON.stringify({ changes: [{
        type: 'upsert', table: 'discussionMessages', key: messageId, value: { realmId: realm.realmId },
      }] }),
    });
    const started = performance.now();
    const response = await receiveDiscussionNotifications(request, env);

    expect(response?.status).toBe(204);
    expect(performance.now() - started).toBeGreaterThanOrEqual(1_950);
    expect(fetchCloud.mock.calls.some(([url]) => decodeURIComponent(String(url)).endsWith(stateId))).toBe(true);
    expect(batch).toHaveBeenCalledTimes(queued ? 1 : 0);
  });
});
