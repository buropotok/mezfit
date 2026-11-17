import { describe, expect, it, vi } from 'vitest';
import { discussionAnchorKey } from '../../shared/discussion-anchor';
import { parseNotificationStartParam } from '../../shared/telegram-notification-link';
import { relationshipMembership } from './dexie-cloud-membership';
import { receiveDiscussionNotifications, sendDiscussionNotifications } from './discussion-notifications';

describe('discussion notification webhook', () => {
  it('persists a publication before starting delivery in the same invocation', async () => {
    const calls: string[] = [];
    const prepare = vi.fn((sql: string) => ({
      bind: () => ({
        all: async () => {
          expect(sql).toContain('SELECT message_id');
          calls.push('delivery');
          return { results: [] };
        },
      }),
    }));
    const batch = vi.fn(async () => { calls.push('persist'); });
    const env = {
      DB_BINDING: { prepare, batch } as unknown as D1Database,
      DEXIE_DISCUSSION_WEBHOOK_SECRET: 'test-webhook-secret',
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      TELEGRAM_BOT_USERNAME: 'mezfit_bot',
    };
    const waitUntil = vi.fn<(task: Promise<unknown>) => void>();
    const request = new Request('https://example.com/api/webhooks/dexie-discussions', {
      method: 'POST',
      headers: { 'X-DexieCloud-Token': 'test-webhook-secret' },
      body: JSON.stringify({
        changes: [{
          type: 'upsert',
          table: 'discussionMessages',
          key: 'message-1',
          value: { realmId: 'rlm' + 'a'.repeat(28) },
        }],
      }),
    });

    const response = await receiveDiscussionNotifications(request, env, { waitUntil });

    expect(response?.status).toBe(204);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(calls).toEqual(['persist', 'delivery']);
  });
});

describe('free discussion notification delivery', () => {
  it.each([
    'valid', 'foreign realm', 'header id mismatch', 'anchor id mismatch', 'substituted entity', 'invalid title', 'foreign author',
  ] as const)('checks a queued free message with %s', async variant => {
    const { realm, members } = await relationshipMembership('456', '123');
    const realmId = realm.realmId;
    const id = 'free-discussion:00000000-0000-4000-8000-000000000001';
    const siblingId = 'free-discussion:00000000-0000-4000-8000-000000000002';
    const messageId = 'free-message';
    const author = variant === 'foreign author' ? 'tg:999' : 'tg:456';
    const anchor = variant === 'substituted entity' ? { kind: 'program' as const, trainingPlanId: 'program' }
      : { kind: 'free' as const, threadId: variant === 'anchor id mismatch' ? siblingId : id };
    const thread = {
      id: variant === 'header id mismatch' ? siblingId : id,
      realmId: variant === 'foreign realm' ? 'other-realm' : realmId,
      owner: realmId, coachClientId: realmId, anchor,
      anchorKey: discussionAnchorKey({ realmId, coachClientId: realmId }, anchor),
      contextPath: [], derivedTitleSnapshot: variant === 'invalid title' ? ' ' : 'Питание & режим',
    };
    const settled = vi.fn();
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: [{ message_id: messageId, realm_id: realmId, attempts: 0 }] }),
          first: async () => ({ telegram_thread_id: 7, topic_title: 'Тренер' }),
          run: async () => {
            if (sql.includes('SET status =')) settled(args[0]);
            return { meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    const deliver = vi.fn<(payload: { chat_id: string; message_thread_id: number; rich_message: { html: string } }) => void>();
    const fetchImpl: typeof fetch = async (input, init) => {
      const { pathname } = new URL(String(input));
      const path = decodeURIComponent(pathname);
      if (path === '/all/discussionMessages/' + messageId) return Response.json({
        id: messageId, realmId, threadId: id, authorUserId: author, owner: author, text: 'Привет',
        createdAt: '2026-11-14T10:00:00.000Z',
      });
      if (path === '/all/discussionThreads/' + id) return Response.json(thread);
      if (path === '/all/members') return Response.json(members);
      if (path === '/all/realms/' + realmId) return Response.json(realm);
      if (path === '/all/messageAttachments') return Response.json([]);
      if (path.startsWith('/all/contactProfiles/') || path.startsWith('/all/discussionReadStates/')) {
        return new Response(null, { status: 404 });
      }
      if (path.endsWith('/sendRichMessage')) {
        deliver(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, result: { message_id: 42 } });
      }
      throw new Error('Unexpected notification request');
    };

    await sendDiscussionNotifications({
      DB_BINDING: db, DEXIE_DISCUSSION_WEBHOOK_SECRET: 'test-webhook-secret',
      TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'mezfit_bot',
    }, fetchImpl, 'read-token');

    if (variant === 'valid') {
      expect(settled).toHaveBeenCalledWith('sent');
      expect(deliver).toHaveBeenCalledExactlyOnceWith({
        chat_id: '123', message_thread_id: 7, rich_message: { html: expect.stringContaining('Питание &amp; режим') },
      });
      const html = deliver.mock.calls[0][0].rich_message.html;
      const param = html.match(/startapp=([^"]+)/)?.[1] ?? null;
      expect(parseNotificationStartParam(param)).toMatchObject({ kind: 'discussion', id: messageId });
    } else {
      expect(settled).toHaveBeenCalledWith('closed');
      expect(deliver).not.toHaveBeenCalled();
    }
  });
});
