import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareApi, inspectBucket } from './cloudflare.mjs';

const account = 'a'.repeat(32);
const bucket = 'mezfit-migration-uploads';
const queue = { queue_id: 'b'.repeat(32) };
const origin = 'https://mezfit.example.com';
const bucketPath = '/r2/buckets/' + bucket;
const notificationsPath = '/event_notifications/r2/' + bucket + '/configuration';

function cloudflareError(status, ...codes) {
  return Response.json({ success: false, errors: codes.map(code => ({ code })), result: null }, { status });
}

function mockApi(notificationResponse) {
  const resources = {
    [bucketPath]: { name: bucket, jurisdiction: 'default' },
    [bucketPath + '/domains/managed']: { enabled: false },
    [bucketPath + '/domains/custom']: { domains: [] },
    [bucketPath + '/cors']: { rules: [] },
  };
  vi.stubGlobal('fetch', vi.fn(async (url, { method }) => {
    const path = new URL(url).pathname.replace('/client/v4/accounts/' + account, '');
    if (method === 'GET' && Object.hasOwn(resources, path)) {
      return Response.json({ success: true, result: resources[path] });
    }
    return notificationResponse();
  }));
  return new CloudflareApi(account, 'test-bootstrap-token', 'CLOUDFLARE_BOOTSTRAP_API_TOKEN');
}

afterEach(() => vi.unstubAllGlobals());

describe('migration R2 notification inspection', () => {
  it('recognizes an existing bucket with no notification configuration', async () => {
    const api = mockApi(() => cloudflareError(404, 11015));

    await expect(inspectBucket(api, queue, origin)).resolves.toEqual({
      bucket: true, private: true, cors: 'missing', notifications: 'missing',
    });
  });

  it('recognizes a rule already configured for the migration queue', async () => {
    const api = mockApi(() => Response.json({
      success: true,
      result: {
        bucketName: bucket,
        queues: [{
          queueId: queue.queue_id,
          rules: [{ actions: ['PutObject', 'CopyObject', 'CompleteMultipartUpload'] }],
        }],
      },
    }));

    await expect(inspectBucket(api, queue, origin)).resolves.toMatchObject({ notifications: 'current' });
  });

  it.each([
    [401, [11015]],
    [403, [11015]],
    [404, [10007]],
    [404, [11015, 9109]],
    [500, [11015]],
  ])('propagates HTTP %i with unexpected Cloudflare error codes %j', async (status, codes) => {
    const api = mockApi(() => cloudflareError(status, ...codes));

    await expect(inspectBucket(api, queue, origin)).rejects.toThrow(
      'failed with HTTP ' + status + ' (Cloudflare codes: ' + codes.join(', ') + ')',
    );
  });

  it('propagates a malformed 404 response', async () => {
    const api = mockApi(() => new Response('not JSON', { status: 404 }));

    await expect(inspectBucket(api, queue, origin)).rejects.toThrow('failed with HTTP 404');
  });

  it('rejects an invalid success response', async () => {
    const api = mockApi(() => Response.json({ success: true, result: null }));

    await expect(inspectBucket(api, queue, origin)).rejects.toThrow('MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID');
  });

  it('propagates the same 404 from other routes and write requests', async () => {
    const api = mockApi(() => cloudflareError(404, 11015));

    await expect(api.get('/queues/' + queue.queue_id)).rejects.toThrow('HTTP 404 (Cloudflare codes: 11015)');
    await expect(api.request(notificationsPath, { method: 'PUT' })).rejects.toThrow('HTTP 404 (Cloudflare codes: 11015)');
  });
});

describe('equivalent and conflicting R2 notification configurations', () => {
  const queueName = 'mezfit-migration-events';
  const queueId = '471537e86e5a4163a4d49478087c32c3';
  const hyphenatedId = '471537e8-6e5a-4163-a4d4-9478087c32c3';
  const selectedQueue = { queue_id: queueId };
  const rule = { actions: ['CopyObject', 'CompleteMultipartUpload', 'PutObject'] };
  const target = { queueId, queueName, rules: [rule] };

  function inspectNotifications(result) {
    return inspectBucket(mockApi(() => Response.json({ success: true, result })), selectedQueue, origin);
  }

  it('accepts the hyphenated Wrangler queue ID, optional rule metadata and empty filters', async () => {
    await expect(inspectNotifications({
      bucketName: bucket,
      queues: [{
        ...target, queueId: hyphenatedId,
        rules: [{ ...rule, prefix: '', suffix: null, ruleId: 'generated-id', description: 'label' }],
      }],
    })).resolves.toMatchObject({ notifications: 'current' });
  });

  it('accepts the legacy bucket-keyed response supported by Wrangler', async () => {
    await expect(inspectNotifications({
      [bucket]: { 'config-id': { queue: hyphenatedId, rules: [{ ...rule, suffix: '' }] } },
    })).resolves.toMatchObject({ notifications: 'current' });
  });

  it.each([
    ['another queue', [{ ...target, queueId: 'a'.repeat(32) }], 'queueId'],
    ['malformed queue ID', [{ ...target, queueId: queueId + '-' }], 'queueId'],
    ['inconsistent queue name', [{ ...target, queueName: 'other-queue' }], 'queueName'],
    ['an extra queue', [target, { ...target, queueId: 'a'.repeat(32) }], 'queues.length'],
    ['an extra rule', [{ ...target, rules: [rule, { ...rule, prefix: 'other/' }] }], 'rules.length'],
    ['a missing rule', [{ ...target, rules: [] }], 'rules.length'],
    ['an extra event', [{ ...target, rules: [{ actions: [...rule.actions, 'DeleteObject'] }] }], 'actions'],
    ['duplicate events', [{ ...target, rules: [{ actions: ['PutObject', 'PutObject', 'CopyObject'] }] }], 'actions'],
    ['a prefix filter', [{ ...target, rules: [{ ...rule, prefix: 'untrusted-prefix-value' }] }], 'prefix'],
    ['a suffix filter', [{ ...target, rules: [{ ...rule, suffix: 'untrusted-suffix-value' }] }], 'suffix'],
    ['a malformed filter', [{ ...target, rules: [{ ...rule, prefix: false }] }], 'prefix'],
  ])('reports %s as a conflict', async (_label, queues, field) => {
    const result = await inspectNotifications({ bucketName: bucket, queues });

    expect(result.notifications).toBe('conflict');
    expect(result.notificationConflict).toContain('R2_EVENT_NOTIFICATIONS_CONFLICT: ' + field);
    expect(result.notificationConflict).not.toContain('untrusted-');
  });

  it('reports extra legacy configurations instead of selecting the first', async () => {
    const link = { queue: hyphenatedId, rules: [rule] };

    await expect(inspectNotifications({
      [bucket]: { first: link, extra: link },
    })).resolves.toMatchObject({
      notifications: 'conflict',
      notificationConflict: 'R2_EVENT_NOTIFICATIONS_CONFLICT: queues.length (expected 1, got 2)',
    });
  });
});
