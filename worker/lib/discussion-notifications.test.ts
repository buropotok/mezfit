import { describe, expect, it, vi } from 'vitest';
import { receiveDiscussionNotifications } from './discussion-notifications';

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
